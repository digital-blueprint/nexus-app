import url from 'node:url';
import process from 'node:process';
import {globSync} from 'glob';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import serve from 'rollup-plugin-serve';
import urlPlugin from '@rollup/plugin-url';
import license from 'rollup-plugin-license';
import del from 'rollup-plugin-delete';
import emitEJS from 'rollup-plugin-emit-ejs';
import {getBabelOutputPlugin} from '@rollup/plugin-babel';
import {getPackagePath, getBuildInfo, generateTLSConfig, getDistPath} from '@dbp-toolkit/dev-utils';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');
const appEnv = typeof process.env.APP_ENV !== 'undefined' ? process.env.APP_ENV : 'local';
const watch = process.env.ROLLUP_WATCH === 'true';
const buildFull = (!watch && appEnv !== 'test') || process.env.FORCE_FULL !== undefined;
let useTerser = buildFull;
let useBabel = buildFull;
let checkLicenses = buildFull;
let treeshake = buildFull;

// if true, app assets and configs are whitelabel
let whitelabel;
// path to non whitelabel assets and configs
let customAssetsPath;
// development path
let devPath = 'assets_custom/dbp-nexus/assets/';
// deployment path
let deploymentPath = '../assets/';

let useHTTPS = true;

// set whitelabel bool according to used environment
if (
    (appEnv.length > 6 && appEnv.substring(appEnv.length - 6) == 'Custom') ||
    appEnv == 'production'
) {
    whitelabel = false;
} else {
    whitelabel = true;
}

// load devconfig for local development if present
let devConfig = require('./app.config.json');
try {
    console.log('Loading ' + './' + devPath + 'app.config.json ...');
    devConfig = require('./' + devPath + 'app.config.json');
    customAssetsPath = devPath;
} catch (e) {
    if (e.code == 'MODULE_NOT_FOUND') {
        console.warn('no dev-config found, try deployment config instead ...');

        // load devconfig for deployment if present
        try {
            console.log('Loading ' + './' + deploymentPath + 'app.config.json ...');
            devConfig = require('./' + deploymentPath + 'app.config.json');
            customAssetsPath = deploymentPath;
        } catch (e) {
            if (e.code == 'MODULE_NOT_FOUND') {
                console.warn('no dev-config found, use default whitelabel config instead ...');
                devConfig = require('./app.config.json');
                customAssetsPath = devPath;
            } else {
                throw e;
            }
        }
    } else {
        throw e;
    }
}

console.log('APP_ENV: ' + appEnv);

let config;
if (devConfig != undefined && appEnv in devConfig) {
    // choose devConfig if available
    config = devConfig[appEnv];
} else if (appEnv === 'test') {
    config = {
        basePath: '/',
        entryPointURL: 'https://test',
        keyCloakBaseURL: 'https://test',
        keyCloakClientId: '',
        keyCloakRealm: '',
        matomoUrl: '',
        matomoSiteId: -1,
        nextcloudBaseURL: 'https://test',
        nextcloudName: '',
        pdfAsQualifiedlySigningServer: 'https://test',
        hiddenActivities: [],
        enableAnnotations: true,
        // typesense: {
        //     host: 'toolbox-backend-dev.tugraz.at',
        //     port: '443',
        //     protocol: 'https',
        //     key: '8NfxGOHntZ3Aat1fWByyoadCctmb7klF'
        // },
        // typesense: {
        //     host: 'typesense.localhost',
        //     port: '9100',
        //     path: '/',
        //     protocol: 'http',
        //     key: 'xyz',
        //     collection: 'cabinet'
        // },
    };
} else {
    console.error(`Unknown build environment: '${appEnv}', use one of '${Object.keys(devConfig)}'`);
    process.exit(1);
}

if (config.nextcloudBaseURL) {
    config.nextcloudFileURL = config.nextcloudBaseURL + '/index.php/apps/files/?dir=';
    config.nextcloudWebAppPasswordURL = config.nextcloudBaseURL + '/index.php/apps/webapppassword';
    config.nextcloudWebDavURL = config.nextcloudBaseURL + '/remote.php/dav/files';
} else {
    config.nextcloudFileURL = '';
    config.nextcloudWebAppPasswordURL = '';
    config.nextcloudWebDavURL = '';
}

if (watch) {
    config.basePath = '/dist/';
}

function getOrigin(url) {
    if (url) return new URL(url).origin;
    return '';
}

// these are the hosts that are allowed to be embedded in an iframe
const atrustHosts = [
    'https://www.handy-signatur.at', // old one
    'https://service.a-trust.at',
];

config.CSP = `default-src 'self' 'unsafe-inline' \
${getOrigin(config.matomoUrl)} ${getOrigin(config.keyCloakBaseURL)} ${getOrigin(
    config.entryPointURL,
)} \
${getOrigin(config.nextcloudBaseURL)} ${atrustHosts.map((h) => getOrigin(h)).join(' ')} \
${getOrigin(config.pdfAsQualifiedlySigningServer)} \
https://*.tugraz.at;\
img-src * blob: data:`;

let input = ['src/' + pkg.internalName + '.js', 'src/dbp-nexus-search.js'];

export default (async () => {
    let privatePath = await getDistPath(pkg.name);
    return {
        input:
            appEnv != 'test'
                ? !whitelabel
                    ? [...input, await getPackagePath('@tugraz/web-components', 'src/logo.js')]
                    : [...input]
                : globSync('test/**/*.js'),
        output: {
            dir: 'dist',
            entryFileNames: '[name].js',
            chunkFileNames: 'shared/[name].[hash].[format].js',
            format: 'esm',
            sourcemap: true,
        },
        treeshake: treeshake,
        onwarn: function (warning, warn) {
            // more eval
            if (warning.code === 'EVAL' && warning.id.includes('pdfAnnotate.js')) {
                return;
            }
            if (warning.code === 'EVAL' && warning.id.includes('pdf.js')) {
                return;
            }
            warn(warning);
        },
        plugins: [
            del({
                targets: 'dist/*',
            }),
            whitelabel &&
                emitEJS({
                    src: 'assets',
                    include: ['**/*.ejs', '**/.*.ejs'],
                    data: {
                        getUrl: (p) => {
                            return url.resolve(config.basePath, p);
                        },
                        getPrivateUrl: (p) => {
                            return url.resolve(`${config.basePath}${privatePath}/`, p);
                        },
                        isVisible: (name) => {
                            return !config.hiddenActivities.includes(name);
                        },
                        name: pkg.internalName,
                        entryPointURL: config.entryPointURL,
                        nextcloudWebAppPasswordURL: config.nextcloudWebAppPasswordURL,
                        nextcloudWebDavURL: config.nextcloudWebDavURL,
                        nextcloudBaseURL: config.nextcloudBaseURL,
                        nextcloudFileURL: config.nextcloudFileURL,
                        nextcloudName: config.nextcloudName,
                        keyCloakBaseURL: config.keyCloakBaseURL,
                        keyCloakRealm: config.keyCloakRealm,
                        keyCloakClientId: config.keyCloakClientId,
                        CSP: config.CSP,
                        matomoUrl: config.matomoUrl,
                        matomoSiteId: config.matomoSiteId,
                        buildInfo: getBuildInfo(appEnv),
                        shortName: config.shortName,
                        appDomain: config.appDomain,
                        enableAnnotations: config.enableAnnotations,
                        // typesenseHost: config.typesense.host,
                        // typesensePort: config.typesense.port,
                        // typesensePath: config.typesense.path,
                        // typesenseProtocol: config.typesense.protocol,
                        // typesenseKey: config.typesense.key,
                        // typesenseCollection: config.typesense.collection,
                        // typesenseNexusHost: config.typesenseNexus.host,
                        // typesenseNexusPort: config.typesenseNexus.port,
                        // typesenseNexusPath: config.typesenseNexus.path,
                        // typesenseNexusProtocol: config.typesenseNexus.protocol,
                        // typesenseNexusKey: config.typesenseNexus.key,
                        // typesenseNexusCollection: config.typesenseNexus.collection,
                    },
                }),
            !whitelabel &&
                emitEJS({
                    src: customAssetsPath,
                    include: ['**/*.ejs', '**/.*.ejs'],
                    data: {
                        getUrl: (p) => {
                            return url.resolve(config.basePath, p);
                        },
                        getPrivateUrl: (p) => {
                            return url.resolve(`${config.basePath}${privatePath}/`, p);
                        },
                        isVisible: (name) => {
                            return !config.hiddenActivities.includes(name);
                        },
                        name: pkg.internalName,
                        entryPointURL: config.entryPointURL,
                        nextcloudWebAppPasswordURL: config.nextcloudWebAppPasswordURL,
                        nextcloudWebDavURL: config.nextcloudWebDavURL,
                        nextcloudBaseURL: config.nextcloudBaseURL,
                        nextcloudFileURL: config.nextcloudFileURL,
                        nextcloudName: config.nextcloudName,
                        keyCloakBaseURL: config.keyCloakBaseURL,
                        keyCloakRealm: config.keyCloakRealm,
                        keyCloakClientId: config.keyCloakClientId,
                        CSP: config.CSP,
                        matomoUrl: config.matomoUrl,
                        matomoSiteId: config.matomoSiteId,
                        buildInfo: getBuildInfo(appEnv),
                        shortName: config.shortName,
                        appDomain: config.appDomain,
                        enableAnnotations: config.enableAnnotations,
                        // typesenseHost: config.typesense.host,
                        // typesensePort: config.typesense.port,
                        // typesensePath: config.typesense.path,
                        // typesenseProtocol: config.typesense.protocol,
                        // typesenseKey: config.typesense.key,
                        // typesenseCollection: config.typesense.collection,
                        // typesenseNexusHost: config.typesenseNexus.host,
                        // typesenseNexusPort: config.typesenseNexus.port,
                        // typesenseNexusPath: config.typesenseNexus.path,
                        // typesenseNexusProtocol: config.typesenseNexus.protocol,
                        // typesenseNexusKey: config.typesenseNexus.key,
                        // typesenseNexusCollection: config.typesenseNexus.collection,
                    },
                }),
            replace({
                // If you would like DEV messages, specify 'development'
                // Otherwise use 'production'
                'process.env.NODE_ENV': JSON.stringify('production'),
                preventAssignment: true,
            }),
            resolve({
                browser: true,
                preferBuiltins: true,
            }),
            checkLicenses &&
                license({
                    banner: {
                        commentStyle: 'ignored',
                        content: `
License: <%= pkg.license %>
Dependencies:
<% _.forEach(dependencies, function (dependency) { if (dependency.name) { %>
<%= dependency.name %>: <%= dependency.license %><% }}) %>
`,
                    },
                    thirdParty: {
                        allow(dependency) {
                            let licenses = [
                                'MIT',
                                '(MIT OR GPL-3.0-or-later)',
                                'Apache-2.0',
                                '(Apache-2.0)',
                                'MIT OR SEE LICENSE IN FEEL-FREE.md',
                                'LGPL-2.1-or-later',
                                'BSD-3-Clause',
                                'BSD-2-Clause',
                                'BSD',
                                '(MPL-2.0 OR Apache-2.0)',
                            ];
                            if (!licenses.includes(dependency.license)) {
                                throw new Error(
                                    `Unknown license for ${dependency.name}: ${dependency.license}`,
                                );
                            }
                            return true;
                        },
                    },
                }),
            commonjs({
                include: 'node_modules/**',
                strictRequires: 'auto',
            }),
            json(),
            urlPlugin({
                limit: 0,
                include: [
                    await getPackagePath('select2', '**/*.css'),
                    await getPackagePath('tippy.js', '**/*.css'),
                ],
                emitFiles: true,
                fileName: 'shared/[name].[hash][extname]',
            }),
            whitelabel &&
                copy({
                    targets: [
                        // {
                        //     src: 'vendor/signature/assets/*-placeholder.png',
                        //     dest: 'dist/' + (await getDistPath('@digital-blueprint/esign-app')),
                        // },
                        // {
                        //     src: 'vendor/dispatch/assets/*-placeholder.png',
                        //     dest: 'dist/' + (await getDistPath('@digital-blueprint/dispatch-app')),
                        // },
                        {src: 'assets/*.css', dest: 'dist/' + (await getDistPath(pkg.name))},
                        {src: 'assets/*.ico', dest: 'dist/' + (await getDistPath(pkg.name))},
                        {
                            src: 'assets/translation_overrides/',
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {src: 'assets/*.metadata.json', dest: 'dist'},
                        {src: 'src/*.metadata.json', dest: 'dist'},
                        {src: 'assets/nexus-modules.json', dest: 'dist'},
                        {src: 'assets/*.svg', dest: 'dist/' + (await getDistPath(pkg.name))},
                        {src: 'assets/htaccess-shared', dest: 'dist/shared/', rename: '.htaccess'},
                        {src: 'assets/icon-*.png', dest: 'dist/' + (await getDistPath(pkg.name))},
                        {src: 'assets/apple-*.png', dest: 'dist/' + (await getDistPath(pkg.name))},
                        {src: 'assets/safari-*.svg', dest: 'dist/' + (await getDistPath(pkg.name))},
                        {src: 'assets/images/*', dest: 'dist/images'},
                        {
                            src: 'assets/icon/*',
                            dest: 'dist/' + (await getDistPath(pkg.name, 'icon')),
                        },
                        {
                            src: 'assets/site.webmanifest',
                            dest: 'dist',
                            rename: pkg.internalName + '.webmanifest',
                        },
                        {src: 'assets/silent-check-sso.html', dest: 'dist'},
                        {
                            src: await getPackagePath(
                                'instantsearch.css',
                                'themes/algolia-min.css',
                            ),
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {
                            src: await getPackagePath(
                                'instantsearch.css',
                                'themes/algolia-min.css',
                            ),
                            dest: 'dist/local/@digital-blueprint/cabinet-app/',
                        },
                        {
                            src: await getPackagePath('@fontsource/nunito-sans', '*'),
                            dest: 'dist/' + (await getDistPath(pkg.name, 'fonts/nunito-sans')),
                        },
                        {
                            src: await getPackagePath('@dbp-toolkit/common', 'src/spinner.js'),
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                            rename: 'org_spinner.js',
                        },
                        {
                            src: await getPackagePath('@dbp-toolkit/common', 'src/spinner.js'),
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {
                            src: await getPackagePath(
                                '@dbp-toolkit/common',
                                'misc/browser-check.js',
                            ),
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {
                            src: await getPackagePath('@dbp-toolkit/common', 'assets/icons/*.svg'),
                            dest: 'dist/' + (await getDistPath('@dbp-toolkit/common', 'icons')),
                        },
                    ],
                }),
            !whitelabel &&
                copy({
                    targets: [
                        {
                            src: customAssetsPath + '*.css',
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {
                            src: customAssetsPath + '*.ico',
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {
                            src: customAssetsPath + 'translation_overrides',
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {src: customAssetsPath + '*.metadata.json', dest: 'dist'},
                        {src: customAssetsPath + 'nexus-modules.json', dest: 'dist'},
                        {
                            src: customAssetsPath + '*.svg',
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {
                            src: customAssetsPath + 'htaccess-shared',
                            dest: 'dist/shared/',
                            rename: '.htaccess',
                        },
                        {
                            src: customAssetsPath + 'icon-*.png',
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {
                            src: customAssetsPath + 'apple-*.png',
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {
                            src: customAssetsPath + 'safari-*.svg',
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {src: customAssetsPath + 'images/*', dest: 'dist/images'},
                        {
                            src: customAssetsPath + 'icon/*',
                            dest: 'dist/' + (await getDistPath(pkg.name, 'icon')),
                        },
                        {
                            src: customAssetsPath + 'site.webmanifest',
                            dest: 'dist',
                            rename: pkg.internalName + '.webmanifest',
                        },
                        {src: customAssetsPath + 'silent-check-sso.html', dest: 'dist'},

                        {
                            src: await getPackagePath(
                                'instantsearch.css',
                                'themes/algolia-min.css',
                            ),
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {
                            src: await getPackagePath('@tugraz/font-source-sans-pro', 'files/*'),
                            dest: 'dist/' + (await getDistPath(pkg.name, 'fonts/source-sans-pro')),
                        },
                        {
                            src: await getPackagePath('@tugraz/web-components', 'src/spinner.js'),
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                            rename: 'tug_spinner.js',
                        },
                        {
                            src: await getPackagePath('@dbp-toolkit/common', 'src/spinner.js'),
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {
                            src: await getPackagePath(
                                '@dbp-toolkit/common',
                                'misc/browser-check.js',
                            ),
                            dest: 'dist/' + (await getDistPath(pkg.name)),
                        },
                        {
                            src: await getPackagePath('@dbp-toolkit/common', 'assets/icons/*.svg'),
                            dest: 'dist/' + (await getDistPath('@dbp-toolkit/common', 'icons')),
                        },
                    ],
                }),

            useBabel &&
                getBabelOutputPlugin({
                    compact: false,
                    presets: [
                        [
                            '@babel/preset-env',
                            {
                                loose: false,
                                shippedProposals: true,
                                bugfixes: true,
                                modules: false,
                                targets: {
                                    esmodules: true,
                                },
                            },
                        ],
                    ],
                }),
            useTerser ? terser() : false,
            watch
                ? serve({
                      contentBase: '.',
                      host: '127.0.0.1',
                      port: 8001,
                      historyApiFallback: config.basePath + pkg.internalName + '.html',
                      https: useHTTPS ? await generateTLSConfig() : false,
                      headers: {
                          'Content-Security-Policy': config.CSP,
                      },
                  })
                : false,
        ],
    };
})();
