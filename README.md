# Nexus Application

[GitHub Repository](https://github.com/digital-blueprint/nexus-app) |
[npmjs package](https://www.npmjs.com/package/@digital-blueprint/nexus-app) |
[Unpkg CDN](https://unpkg.com/browse/@digital-blueprint/nexus-app/) |

[![Build and Test](https://github.com/digital-blueprint/nexus-app/actions/workflows/build-test-publish.yml/badge.svg)](https://github.com/digital-blueprint/nexus-app/actions/workflows/build-test-publish.yml)

This is an application for searching DigitalBlueprint activities.

## Prerequisites

- You need the [API server](https://gitlab.tugraz.at/dbp/relay/dbp-relay-server-template) running

## Local development

```bash
# get the source
git clone git@github.com:digital-blueprint/nexus-app.git
cd nexus-app
git submodule update --init

# install dependencies
npm install

# constantly build dist/bundle.js and run a local web-server on port 8001
npm run watch

# constantly build dist/bundle.js and run a local web-server on port 8001 using a custom assets directory assets_custom/
npm run watch-custom

# run tests
npm test
```

### Typesense schema
```json
{
  "name": "nexus",
  "fields": [
    {
      "name": "activityName",
      "type": "string",
      "facet": false,
      "optional": false,
      "index": true,
      "sort": true,
      "infix": false,
      "locale": "",
      "stem": false,
      "store": true
    },
    {
      "name": "activityDescription",
      "type": "string",
      "facet": false,
      "optional": false,
      "index": true,
      "sort": false,
      "infix": false,
      "locale": "",
      "stem": false,
      "store": true
    },
    {
      "name": "activityRoutingName",
      "type": "string",
      "facet": false,
      "optional": false,
      "index": false,
      "sort": false,
      "infix": false,
      "locale": "",
      "stem": false,
      "store": true
    },
    {
      "name": "activityModuleSrc",
      "type": "string",
      "facet": false,
      "optional": false,
      "index": false,
      "sort": false,
      "infix": false,
      "locale": "",
      "stem": false,
      "store": true
    },
    {
      "name": "activityPath",
      "type": "string",
      "facet": false,
      "optional": false,
      "index": false,
      "sort": false,
      "infix": false,
      "locale": "",
      "stem": false,
      "store": true
    },
    {
      "name": "activityTag",
      "type": "string[]",
      "facet": false,
      "optional": false,
      "index": true,
      "sort": false,
      "infix": false,
      "locale": "",
      "stem": false,
      "store": true
    },
    {
      "name": "activityIcon",
      "type": "string",
      "facet": false,
      "optional": false,
      "index": false,
      "sort": false,
      "infix": false,
      "locale": "",
      "stem": false,
      "store": true
    }
  ],
  "default_sorting_field": "",
  "enable_nested_fields": false,
  "symbols_to_index": [],
  "token_separators": []
}
```

Jump to <http://localhost:8001>, and you should get a Single Sign On login page.

By default, the application is built using the assets in `assets/`. However, custom assets can also be used to build the application. The custom assets can be added to the directory `assets_custom/dbp-nexus/assets/`. This allows developers to easily develop and build the application for different environments.

To use the Nextcloud functionality you need a running Nextcloud server with the
[webapppassword](https://gitlab.tugraz.at/dbp/nextcloud/webapppassword) Nextcloud app like this
[Nextcloud Development Environment](https://gitlab.tugraz.at/dbp/nextcloud/webapppassword/-/tree/master/docker).


## Using this app as pre-built package

### Install app

If you want to install the dbp nexus app in a new folder `nexus-app` with a path prefix `/` you can call:

```bash
npx @digital-blueprint/cli@latest install-app nexus nexus-app /
```

Afterward you can point your Apache web-server to `nexus-app/public`.

Make sure you are allowing `.htaccess` files in your Apache configuration.

Also make sure to add all of your resources you are using (like your API and Keycloak servers) to the
`Content-Security-Policy` in your `nexus-app/public/.htaccess`, so the browser allows access to those sites.

You can also use this app directly from the [Unpkg CDN](https://unpkg.com/browse/@digital-blueprint/nexus-app/)
for example like this: [dbp-nexus/index.html](https://github.com/digital-blueprint/nexus-app/tree/main/examples/dbp-nexus/index.html)

Note that you will need a Keycloak server along with a client id for the domain you are running this html on.

### Update app

If you want to update the dbp nexus app in the current folder you can call:

```bash
npx @digital-blueprint/cli@latest update-app nexus
```

## Adapt app

### Functionality

You can add multiple attributes to the `<dbp-nexus>` tag.

| attribute name | value | Link to description                                                                                                                 |
|----------------|-------|-------------------------------------------------------------------------------------------------------------------------------------|
| `provider-root` | Boolean | [app-shell](https://gitlab.tugraz.at/dbp/web-components/toolkit/-/tree/main/packages/app-shell#attributes)                          |
| `lang`         | String | [language-select](https://gitlab.tugraz.at/dbp/web-components/toolkit/-/tree/main/packages/language-select#attributes)              |
| `entry-point-url` | String | [app-shell](https://gitlab.tugraz.at/dbp/web-components/toolkit/-/tree/main/packages/app-shell#attributes)                          |
| `keycloak-config` | Object | [app-shell](https://gitlab.tugraz.at/dbp/web-components/toolkit/-/tree/main/packages/app-shell#attributes)                          |
| `base-path` | String | [app-shell](https://gitlab.tugraz.at/dbp/web-components/toolkit/-/tree/main/packages/app-shell#attributes)                          |
| `src` | String | [app-shell](https://gitlab.tugraz.at/dbp/web-components/toolkit/-/tree/main/packages/app-shell#attributes)                          |
| `html-overrides` | String | [common](https://gitlab.tugraz.at/dbp/web-components/toolkit/-/tree/main/packages/common#overriding-slots-in-nested-web-components) |
| `themes` | Array | [theme-switcher](https://gitlab.tugraz.at/dbp/web-components/toolkit/-/tree/main/packages/theme-switcher#themes-attribute)          |
| `darkModeThemeOverride` | String | [theme-switcher](https://gitlab.tugraz.at/dbp/web-components/toolkit/-/tree/main/packages/theme-switcher#themes-attribute)          |

#### Mandatory attributes

If you are not using the `provider-root` attribute to "terminate" all provider attributes
you need to manually add these attributes so that the topic will work properly:

```html
<dbp-nexus
  auth
  requested-login-status
  analytics-event
  initial-file-handling-state
  clipboard-files
>
</dbp-nexus>
```

### Design

For frontend design customizations, such as logo, colors, font, favicon, and more, take a look at the [theming documentation](https://dbp-demo.tugraz.at/dev-guide/frontend/theming/).

## "dbp-nexus" slots

These are common slots for the app-shell. You can find the documentation of these slots in the [app-shell documentation](https://gitlab.tugraz.at/dbp/web-components/toolkit/-/tree/main/packages/app-shell).
For the app specific slots take a look at the [nexus activities](https://github.com/digital-blueprint/nexus-app/tree/main/src).
