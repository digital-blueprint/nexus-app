import {AppShell} from '@dbp-toolkit/app-shell';
import {css, html, unsafeCSS} from 'lit';
import {classMap} from 'lit/directives/class-map.js';
import * as commonStyles from '@dbp-toolkit/common/styles';
import {getIconSVGURL} from './utils.js';
import {send} from '@dbp-toolkit/common/notification';
import {Icon} from '@dbp-toolkit/common';

const TYPESENSE_COLLECTION = 'nexus--current';
export class NexusAppShell extends AppShell {
    constructor() {
        super();
        this.boundOpenActivityHandler = this.openActivity.bind(this);
        this.boundActivityFavorized = this.handleActivityFavorized.bind(this);
        this.typesenseActivities = [];
        this.favoriteActivities = [];
    }

    static get properties() {
        return {
            ...super.properties,
            favoriteActivities: {type: Object, attribute: false},
        };
    }

    static get scopedElements() {
        return {
            ...super.scopedElements,
            'dbp-icon': Icon,
        };
    }

    connectedCallback() {
        super.connectedCallback();

        document.addEventListener('click', this.boundOpenActivityHandler);
        document.addEventListener('dbp-favorized', this.boundActivityFavorized);

        this.favoriteActivities =
            JSON.parse(localStorage.getItem('nexus-favorite-activities')) || [];
    }

    disconnectedCallback() {
        document.removeEventListener('click', this.boundOpenActivityHandler);
        document.removeEventListener('dbp-favorized', this.boundActivityFavorized);
    }

    async waitForAuth() {
        return new Promise((resolve) => {
            const checkAuth = () => {
                if (this.auth && this.auth.token) {
                    resolve();
                } else {
                    setTimeout(checkAuth, 100); // Retry after 100ms
                }
            };
            checkAuth();
        });
    }

    /**
     * Fetches the metadata of the components we want to use in the menu, dynamically imports the js modules for them,
     * then triggers a rebuilding of the menu and resolves the current route
     * @param {string} topicURL The topic metadata URL or relative path to load things from
     */
    async fetchMetadata(topicURL) {
        // Wait for this.auth to be populated
        await this.waitForAuth();

        let metadata = {};
        let routes = [];

        const result = await (
            await fetch(topicURL, {
                headers: {'Content-Type': 'application/json'},
            })
        ).json();

        this.topic = result;

        // Get other activities from typesense
        // console.log('this.auth.token', this.auth.token);

        try {
            let typesenseUrl = new URL(this.entryPointUrl + '/nexus/typesense');
            const typesenseActivities = await fetch(`${typesenseUrl}/multi_search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + this.auth.token,
                },
                body: JSON.stringify({
                    searches: [
                        {
                            query_by: 'activityName',
                            collection: TYPESENSE_COLLECTION,
                            q: '*',
                            page: 1,
                            per_page: 250,
                        },
                    ],
                }),
            });

            const typesenseResult = await typesenseActivities.json();

            console.log('typesenseResult.results', typesenseResult.results);

            if (Array.isArray(typesenseResult.results) && typesenseResult.results.length > 0) {
                const hits = typesenseResult.results.pop().hits;

                if (Array.isArray(hits) && hits.length > 0) {
                    // Merge Typesense activities into result.activities
                    hits.forEach((hit) => {
                        const activity = {
                            name: hit.document.activityName,
                            path: hit.document.activityPath,
                        };
                        result.activities.push(activity);
                    });
                }
            }
        } catch (error) {
            console.error('Error fetching Typesense activities:', error);
            send({
                summary: 'Error!',
                body: 'Error fetching Typesense activities',
                type: 'danger',
                timeout: 5,
            });
        }

        const fetchOne = async (url) => {
            const result = await fetch(url, {
                headers: {'Content-Type': 'application/json'},
            });
            if (!result.ok) throw result;

            const jsondata = await result.json();
            if (jsondata['element'] === undefined)
                throw new Error('no element defined in metadata');

            return jsondata;
        };

        let promises = [];
        for (const activity of result.activities) {
            const actURL = new URL(activity.path, new URL(topicURL, window.location.href).href)
                .href;
            promises.push([
                activity.visible === undefined || activity.visible,
                actURL,
                fetchOne(actURL),
            ]);
        }

        for (const [visible, actURL, p] of promises) {
            try {
                const activity = await p;
                activity.visible = visible;
                // Resolve module_src relative to the location of the json file
                activity.module_src = new URL(activity.module_src, actURL).href;
                activity.required_roles = activity.required_roles || [];
                metadata[activity.routing_name] = activity;
                routes.push(activity.routing_name);
            } catch (error) {
                console.log(error);
            }
        }

        // this also triggers a rebuilding of the menu
        this.metadata = metadata;
        this.routes = routes;

        // Switch to the first route if none is selected
        if (!this.activeView) this.switchComponent(routes[0]);
        else this.switchComponent(this.activeView);
    }

    _renderActivity() {
        const act = this.metadata[this.activeView];
        if (act === undefined) return html``;

        const elm = this._createActivityElement(act);

        // add subscriptions for the provider component
        if (act.subscribe !== undefined) {
            elm.setAttribute('subscribe', act.subscribe);
        }

        // add any additional attributes defined in the metadata
        if (act.attributes !== undefined) {
            for (const [key] of Object.entries(act.attributes)) {
                if (key === 'favorite-activities') {
                    elm.setAttribute(key, JSON.stringify(this.favoriteActivities));
                }
            }
        }

        return elm;
    }

    openActivity(e) {
        // @TODO change to custom event
        console.log('openActivity', e);

        const link = e.composedPath()[0];
        const href = link.getAttribute('data-nav');
        if (href) {
            let partialState = {
                component: href,
            };
            let location = this.router.getPathname(partialState);
            this.router.updateFromUrl(location);
        }
    }

    handleActivityFavorized(e) {
        console.log('handleActivityFavorized', e);

        const activityName = e.detail.activityName;
        const icon = e.detail.icon;
        const activityRoute = e.detail.activityRoute;
        // Toggle icon and favorite status
        if (icon.name === 'star-empty') {
            const activityExists = this.favoriteActivities.some(
                (item) => item.name === activityName,
            );
            if (!activityExists) {
                this.favoriteActivities = [
                    ...this.favoriteActivities,
                    {
                        name: activityName,
                        route: activityRoute,
                    },
                ];
            }
            icon.name = 'star-filled';
        } else {
            this.favoriteActivities = this.favoriteActivities.filter(
                (item) => item.name !== activityName,
            );
            icon.name = 'star-empty';
        }
        // Save this.favoriteActivities to localstorage
        localStorage.setItem('nexus-favorite-activities', JSON.stringify(this.favoriteActivities));
        this.requestUpdate();
    }

    toggleFavorites(e) {
        console.log('toggle fav event', e);
        const favoriteContainer = this._('.favorite-activities-container');
        favoriteContainer.classList.toggle('closed');
    }

    static get styles() {
        // language=css
        return css`
            ${commonStyles.getThemeCSS()}
            ${commonStyles.getGeneralCSS()}
            ${commonStyles.getLinkCss()}

            .hidden {
                display: none;
            }

            h1.title {
                margin-bottom: 0;
                font-weight: 300;
            }

            #main {
                --default-layout-max-width: 1440px;
                --wide-layout-max-width: 1920px;
                --sidebar-width: 250px;
                --page-padding: 20px;
                display: grid;
                grid-template-columns: 1fr;
                grid-template-areas: 'header' 'headline' 'main' 'footer';
                grid-template-rows: min-content min-content 1fr min-content;
                margin: 0 auto;
                min-height: 100vh;
            }

            header,
            #headline,
            main,
            footer {
                width: calc(100% - 2 * var(--page-padding));
                max-width: var(--default-layout-max-width);
                margin: 0 auto;
                padding: 0 20px;
            }

            header {
                grid-area: header;
                display: grid;
                grid-template-columns: 50% 1px auto;
                grid-template-rows: 60px 60px;
                grid-template-areas: 'hd1-left hd1-middle hd1-right' 'hd2-left . hd2-right';
            }

            #headline {
                grid-area: headline;
                text-align: center;
                margin-top: 2em;
                margin-bottom: 3em;
            }

            main {
                grid-area: main;
                container: main / inline-size;
            }

            footer {
                grid-area: footer;
                text-align: right;
            }

            #main.wide-layout {
                max-width: var(--wide-layout-max-width);

                header,
                main,
                footer {
                    max-width: var(--wide-layout-max-width);
                }

                .activity-container {
                    max-width: calc(var(--wide-layout-max-width) - var(--sidebar-width));
                }
            }

            header .hd1-left {
                display: flex;
                flex-direction: row;
                justify-content: flex-end;
                -webkit-justify-content: flex-end;
                grid-area: hd1-left;
                text-align: right;
                padding-right: 20px;
                align-items: center;
                -webkit-align-items: center;
                gap: 10px;
            }

            header .hd1-middle {
                grid-area: hd1-middle;
                background-color: var(--dbp-content);
                background: linear-gradient(
                    180deg,
                    var(--dbp-content) 0%,
                    var(--dbp-content) 85%,
                    rgba(0, 0, 0, 0) 90%
                );
            }

            header .hd1-right {
                grid-area: hd1-right;
                display: flex;
                justify-content: flex-start;
                -webkit-justify-content: flex-start;
                padding: 0 20px;
                min-width: 0;
                align-items: center;
                -webkit-align-items: center;
            }

            header .hd1-right .auth-button {
                min-width: 0;
            }

            header .hd2-left {
                grid-area: hd2-left;
                display: flex;
                flex-direction: column;
                white-space: nowrap;
            }

            header .hd2-left .header {
                margin-left: 50px;
            }

            header .hd2-left a:hover {
                color: var(--dbp-hover-color, var(--dbp-content));
                background-color: var(--dbp-hover-background-color);
            }

            header .hd2-right {
                grid-area: hd2-right;
                display: flex;
                flex-direction: column;
                justify-content: center;
                text-align: right;
            }

            header a {
                color: var(--dbp-content);
                display: inline;
            }

            footer {
                display: flex;
                justify-content: flex-end;
                flex-wrap: wrap;
            }

            footer > *,
            footer slot > * {
                margin: 0.5em 0 0 1em;
            }

            footer a {
                border-bottom: var(--dbp-border);
                padding: 0;
            }

            footer a:hover {
                color: var(--dbp-hover-color, var(--dbp-content));
                background-color: var(--dbp-hover-background-color);
                border-color: var(--dbp-hover-color, var(--dbp-content));
            }

            .description {
                text-align: left;
                margin-bottom: 1rem;
                display: none;
            }

            #dbp-notification {
                z-index: 99999;
            }

            @media (max-width: 768px) {
                #main {
                    grid-template-columns: minmax(0, auto);
                    grid-template-rows: min-content min-content min-content 1fr min-content;
                    grid-template-areas: 'header' 'headline' 'sidebar' 'main' 'footer';
                }

                header {
                    grid-template-rows: 40px;
                    grid-template-areas: 'hd1-left hd1-middle hd1-right';
                }

                header .hd2-left,
                header .hd2-right {
                    display: none;
                }
            }

            header .hd2-left .header {
                margin: 0 0 0 1em;
            }

            .page-container {
                display: grid;
                grid-template-columns: var(--sidebar-width) minmax(0, auto);
                gap: 2em;
            }

            @container main (width < 700px) {
                .page-container {
                    display: grid;
                    grid-template-columns: minmax(0, auto);
                    gap: 1em;
                }
            }

            .activity-container {
                width: 100%;
                max-width: calc(var(--default-layout-max-width) - var(--sidebar-width));
            }

            .favorite-activities-container {
                grid-area: initial; /* override appshell style */
                padding: 0;
                margin: 0;
                border: 1px solid #c4c8d8;
                box-shadow: 0 2px 5px 0px #e3e5ec;
                position: relative;
            }

            .favorite-activities-container.closed .favorite-list {
                height: 0;
                overflow: hidden;
            }

            .favorite-item {
                transform: translateY(10px);
                animation: 0.3s ease forwards fadeIn;
            }

            @keyframes fadeIn {
                from {
                    opacity: 0;
                    transform: translateY(10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            .favorite-header {
                background-color: var(--dbp-background);
                position: relative;
                height: 3em;
                display: flex;
                justify-content: space-between;
                padding: 1em 1em 0 1em;
                align-items: center;
            }

            .favorite-header--home {
                background-color: #e7e7e7;
                cursor: pointer;
                padding: 0;
            }

            .favorite-header-home-title {
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                padding: 0 0.75em;
                font-size: 1.5em;
                background: right 0.75em center no-repeat url('${unsafeCSS(getIconSVGURL('home'))}');
                background-size: 1em;
            }

            .favorite-header-title {
                font-size: 1.5em;
            }

            .favorite-header-icon {
                color: var(--dbp-override-primary);
                font-size: 24px;
                position: static;
            }

            .toggle-favorites {
                position: absolute;
                top: 1em;
                right: 1em;
                display: none;
            }

            @media (width < 768px) {
                .toggle-favorites {
                    display: block !important;
                }
            }

            .favorite-list {
                padding: 1em;
                margin: 0;
                list-style: none;
                display: flex;
                flex-direction: column;
                gap: 0.5em;
            }
        `;
    }

    render() {
        let i18n = this._i18n;

        // We hide the app until we are either fully logged in or logged out
        // At the same time when we hide the main app we show the main slot (e.g. a loading spinner)
        const appHidden = this._loginStatus === 'unknown' || this._loginStatus === 'logging-in';
        const mainClassMap = classMap({hidden: appHidden});
        const slotClassMap = classMap({hidden: !appHidden});

        if (!appHidden) {
            // if app is loaded correctly, remove spinner
            this.updateComplete.then(() => {
                const slot = this.shadowRoot.querySelector('slot:not([name])');

                // remove for safari 12 support. safari 13+ supports display: none on slots.
                if (slot) slot.remove();
            });
        }

        const prodClassMap = classMap({
            hidden: this.env === 'production' || this.env === 'demo' || this.env === '',
        });

        this.updatePageTitle();
        this.updatePageMetaDescription();

        for (let routingName of this.visibleRoutes) {
            let partialState = {
                component: routingName,
            };
            // clear the extra state for everything but the current activity
            if (this.activeView !== routingName) {
                partialState['extra'] = [];
            }
        }

        const kc = this.keycloakConfig;
        const wideLayout = this.currentLayout === 'wide';
        return html`
            <slot class="${slotClassMap}"></slot>
            <dbp-auth-keycloak
                subscribe="requested-login-status"
                lang="${this.lang}"
                entry-point-url="${this.entryPointUrl}"
                url="${kc.url}"
                realm="${kc.realm}"
                client-id="${kc.clientId}"
                silent-check-sso-redirect-uri="${kc.silentCheckSsoRedirectUri || ''}"
                scope="${kc.scope || ''}"
                idp-hint="${kc.idpHint || ''}"
                ?no-check-login-iframe="${kc.noCheckLoginIframe ?? false}"
                ?force-login="${kc.forceLogin}"
                ?try-login="${!kc.forceLogin}"></dbp-auth-keycloak>
            <dbp-matomo
                subscribe="auth,analytics-event"
                endpoint="${this.matomoUrl}"
                site-id="${this.matomoSiteId}"
                git-info="${this.gitInfo}"></dbp-matomo>
            <div class="${mainClassMap}" id="root">
                <div id="main" class="${classMap({'wide-layout': wideLayout})}">
                    <dbp-notification id="dbp-notification" lang="${this.lang}"></dbp-notification>
                    <header>
                        <slot name="header">
                            <div class="hd1-left">
                                <dbp-theme-switcher
                                    subscribe="themes,dark-mode-theme-override"
                                    lang="${this.lang}"></dbp-theme-switcher>
                                <dbp-layout-switcher
                                    class="${classMap({hidden: this.disableLayouts})}"
                                    subscribe="default-layout,disabled-layout,app-name"
                                    lang="${this.lang}"
                                    @layout-changed="${this
                                        .handleLayoutChange}"></dbp-layout-switcher>
                                <dbp-language-select
                                    id="lang-select"
                                    lang="${this.lang}"></dbp-language-select>
                            </div>
                            <div class="hd1-middle"></div>
                            <div class="hd1-right">
                                <dbp-auth-menu-button
                                    data-testid="dbp-auth-menu-button"
                                    subscribe="auth"
                                    class="auth-button"
                                    lang="${this.lang}"></dbp-auth-menu-button>
                            </div>
                            <div class="hd2-left">
                                <div class="header">
                                    <slot name="name">
                                        DBP
                                        <br />
                                        Digital Blueprint
                                    </slot>
                                </div>
                            </div>
                            <div class="hd2-right">
                                <slot name="logo">
                                    <dbp-themed>
                                        <div
                                            slot="light"
                                            style="width: 80px; height:80px; float:right;">
                                            <svg
                                                id="Ebene_1"
                                                data-name="Ebene 1"
                                                xmlns="http://www.w3.org/2000/svg"
                                                xmlns:xlink="http://www.w3.org/1999/xlink"
                                                viewBox="0 0 400 400">
                                                <defs>
                                                    <style>
                                                        .cls-1 {
                                                            fill: none;
                                                        }

                                                        .cls-2 {
                                                            clip-path: url(#clippath);
                                                        }

                                                        .cls-3 {
                                                            fill: url(#Unbenannter_Verlauf_24-2);
                                                        }

                                                        .cls-4 {
                                                            fill: #002a60;
                                                        }

                                                        .cls-5 {
                                                            fill: #fff;
                                                        }

                                                        .cls-6 {
                                                            clip-path: url(#clippath-1);
                                                        }

                                                        .cls-7 {
                                                            clip-path: url(#clippath-2);
                                                        }

                                                        .cls-8 {
                                                            opacity: 0.23;
                                                        }

                                                        .cls-9 {
                                                            opacity: 0.43;
                                                        }

                                                        .cls-10 {
                                                            fill: url(#Unbenannter_Verlauf_25);
                                                        }

                                                        .cls-11 {
                                                            fill: url(#Unbenannter_Verlauf_23);
                                                        }

                                                        .cls-12 {
                                                            fill: url(#Unbenannter_Verlauf_24);
                                                        }

                                                        .cls-13 {
                                                            fill: url(#Unbenannter_Verlauf_26);
                                                        }

                                                        .cls-14 {
                                                            fill: url(#Unbenannter_Verlauf_29);
                                                        }

                                                        .cls-15 {
                                                            fill: url(#Unbenannter_Verlauf_27);
                                                        }

                                                        .cls-16 {
                                                            fill: url(#Unbenannter_Verlauf_28);
                                                        }

                                                        .cls-17 {
                                                            fill: url(#Unbenannter_Verlauf_22);
                                                        }

                                                        .cls-18 {
                                                            fill: url(#Unbenannter_Verlauf_20);
                                                        }

                                                        .cls-19 {
                                                            fill: url(#Unbenannter_Verlauf_7);
                                                        }

                                                        .cls-20 {
                                                            fill: url(#Unbenannter_Verlauf_21);
                                                            opacity: 0.29;
                                                        }

                                                        .cls-20,
                                                        .cls-21,
                                                        .cls-22,
                                                        .cls-23 {
                                                            isolation: isolate;
                                                        }

                                                        .cls-21 {
                                                            fill: url(#Unbenannter_Verlauf_18);
                                                            opacity: 0.9;
                                                        }

                                                        .cls-22 {
                                                            fill: url(#Unbenannter_Verlauf_17);
                                                            opacity: 0.5;
                                                        }

                                                        .cls-23 {
                                                            fill: url(#Unbenannter_Verlauf_19);
                                                            opacity: 0.61;
                                                        }
                                                    </style>
                                                    <clipPath id="clippath">
                                                        <rect
                                                            class="cls-1"
                                                            x="71.91"
                                                            y="102.74"
                                                            width="197.49"
                                                            height="197.49"
                                                            transform="translate(-92.48 179.68) rotate(-45)" />
                                                    </clipPath>
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_24"
                                                        data-name="Unbenannter Verlauf 24"
                                                        x1="113.84"
                                                        y1="-794.55"
                                                        x2="113.84"
                                                        y2="-1126.95"
                                                        gradientTransform="translate(57.31 1166.62)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop offset="0" stop-color="#c2244e" />
                                                        <stop offset=".03" stop-color="#b42855" />
                                                        <stop offset=".15" stop-color="#8a346a" />
                                                        <stop offset=".25" stop-color="#693d7a" />
                                                        <stop offset=".36" stop-color="#524486" />
                                                        <stop offset=".45" stop-color="#44488d" />
                                                        <stop offset=".54" stop-color="#3f498f" />
                                                        <stop offset=".88" stop-color="#2c8ae1" />
                                                        <stop offset="1" stop-color="#25a1ff" />
                                                    </linearGradient>
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_29"
                                                        data-name="Unbenannter Verlauf 29"
                                                        x1="-165.83"
                                                        y1="-964.7"
                                                        x2="113.75"
                                                        y2="-964.7"
                                                        gradientTransform="translate(57.31 1166.62)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop offset=".22" stop-color="#0051b4" />
                                                        <stop
                                                            offset="1"
                                                            stop-color="#37529c"
                                                            stop-opacity="0" />
                                                    </linearGradient>
                                                    <radialGradient
                                                        id="Unbenannter_Verlauf_28"
                                                        data-name="Unbenannter Verlauf 28"
                                                        cx="9160.09"
                                                        cy="-564.48"
                                                        fx="9160.09"
                                                        fy="-564.48"
                                                        r="68.82"
                                                        gradientTransform="translate(6760.46 19576.59) rotate(-105.23) scale(2.23 2.04) skewX(.89)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop offset=".1" stop-color="#002a60" />
                                                        <stop
                                                            offset=".32"
                                                            stop-color="#042d65"
                                                            stop-opacity=".76" />
                                                        <stop
                                                            offset=".57"
                                                            stop-color="#113672"
                                                            stop-opacity=".48" />
                                                        <stop
                                                            offset=".83"
                                                            stop-color="#254589"
                                                            stop-opacity=".19" />
                                                        <stop
                                                            offset="1"
                                                            stop-color="#37529c"
                                                            stop-opacity="0" />
                                                    </radialGradient>
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_27"
                                                        data-name="Unbenannter Verlauf 27"
                                                        x1="1979.02"
                                                        y1="-1764.25"
                                                        x2="1979.02"
                                                        y2="-1917.19"
                                                        gradientTransform="translate(-1952.58 2473.57) rotate(-9.17) scale(1.25 1)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop offset="0" stop-color="#c2244e" />
                                                        <stop
                                                            offset=".54"
                                                            stop-color="#703f7c"
                                                            stop-opacity=".61" />
                                                        <stop
                                                            offset=".54"
                                                            stop-color="#6e407d"
                                                            stop-opacity=".6" />
                                                        <stop
                                                            offset=".88"
                                                            stop-color="#37529c"
                                                            stop-opacity="0" />
                                                    </linearGradient>
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_26"
                                                        data-name="Unbenannter Verlauf 26"
                                                        x1="1151.48"
                                                        y1="791.85"
                                                        x2="1138.92"
                                                        y2="932.97"
                                                        gradientTransform="translate(-1089.46 -1621.51) rotate(4.97) scale(1.22 2.01)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop offset=".05" stop-color="#25a1ff" />
                                                        <stop
                                                            offset=".47"
                                                            stop-color="#108fff"
                                                            stop-opacity=".74" />
                                                        <stop
                                                            offset="1"
                                                            stop-color="#0037d3"
                                                            stop-opacity="0" />
                                                    </linearGradient>
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_25"
                                                        data-name="Unbenannter Verlauf 25"
                                                        x1="118.66"
                                                        y1="-796.84"
                                                        x2="118.66"
                                                        y2="-986.06"
                                                        gradientTransform="translate(57.31 1166.62)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop offset=".15" stop-color="#c2244e" />
                                                        <stop
                                                            offset=".61"
                                                            stop-color="#703f7c"
                                                            stop-opacity=".61" />
                                                        <stop
                                                            offset=".88"
                                                            stop-color="#37529c"
                                                            stop-opacity="0" />
                                                    </linearGradient>
                                                    <clipPath id="clippath-1">
                                                        <rect
                                                            class="cls-1"
                                                            x="102.72"
                                                            y="102.72"
                                                            width="197.51"
                                                            height="197.51"
                                                            transform="translate(-83.46 201.48) rotate(-45)" />
                                                    </clipPath>
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_24-2"
                                                        data-name="Unbenannter Verlauf 24"
                                                        x1="144.67"
                                                        y1="1426.07"
                                                        x2="144.67"
                                                        y2="1758.51"
                                                        gradientTransform="translate(57.31 1798.16) scale(1 -1)"
                                                        xlink:href="#Unbenannter_Verlauf_24" />
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_23"
                                                        data-name="Unbenannter Verlauf 23"
                                                        x1="217.53"
                                                        y1="1716.77"
                                                        x2="137.96"
                                                        y2="1521.21"
                                                        gradientTransform="translate(57.31 1798.16) scale(1 -1)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop offset=".08" stop-color="#25a1ff" />
                                                        <stop offset=".23" stop-color="#1b81d5" />
                                                        <stop offset=".4" stop-color="#1162ab" />
                                                        <stop offset=".57" stop-color="#0a4a8a" />
                                                        <stop offset=".72" stop-color="#043873" />
                                                        <stop offset=".87" stop-color="#012e65" />
                                                        <stop offset="1" stop-color="#002a60" />
                                                    </linearGradient>
                                                    <radialGradient
                                                        id="Unbenannter_Verlauf_22"
                                                        data-name="Unbenannter Verlauf 22"
                                                        cx="4353.28"
                                                        cy="-101.73"
                                                        fx="4353.28"
                                                        fy="-101.73"
                                                        r="182.49"
                                                        gradientTransform="translate(-8977.34 -70.94) scale(2.11 -1.56)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop
                                                            offset="0"
                                                            stop-color="#002a60"
                                                            stop-opacity="0" />
                                                        <stop
                                                            offset=".1"
                                                            stop-color="#082a5f"
                                                            stop-opacity=".1" />
                                                        <stop
                                                            offset=".27"
                                                            stop-color="#1e295d"
                                                            stop-opacity=".27" />
                                                        <stop
                                                            offset=".47"
                                                            stop-color="#43285a"
                                                            stop-opacity=".47" />
                                                        <stop
                                                            offset=".7"
                                                            stop-color="#752655"
                                                            stop-opacity=".7" />
                                                        <stop
                                                            offset=".95"
                                                            stop-color="#b5244f"
                                                            stop-opacity=".95" />
                                                        <stop offset="1" stop-color="#c2244e" />
                                                    </radialGradient>
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_21"
                                                        data-name="Unbenannter Verlauf 21"
                                                        x1="2393.8"
                                                        y1="-9473.74"
                                                        x2="2747.55"
                                                        y2="-9473.74"
                                                        gradientTransform="translate(9117.66 -3987.06) rotate(80.2) scale(1 -1)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop
                                                            offset="0"
                                                            stop-color="#002a60"
                                                            stop-opacity="0" />
                                                        <stop
                                                            offset=".1"
                                                            stop-color="#082a5f"
                                                            stop-opacity=".1" />
                                                        <stop
                                                            offset=".27"
                                                            stop-color="#1e295d"
                                                            stop-opacity=".27" />
                                                        <stop
                                                            offset=".47"
                                                            stop-color="#43285a"
                                                            stop-opacity=".47" />
                                                        <stop
                                                            offset=".7"
                                                            stop-color="#752655"
                                                            stop-opacity=".7" />
                                                        <stop
                                                            offset=".89"
                                                            stop-color="#b5244f"
                                                            stop-opacity=".95" />
                                                        <stop offset="1" stop-color="#c2244e" />
                                                    </linearGradient>
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_20"
                                                        data-name="Unbenannter Verlauf 20"
                                                        x1="1466.29"
                                                        y1="-43.44"
                                                        x2="1453.98"
                                                        y2="-141.33"
                                                        gradientTransform="translate(-1539.01 -194.46) rotate(4.97) scale(1.22 -2.01)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop offset=".18" stop-color="#25a1ff" />
                                                        <stop
                                                            offset=".46"
                                                            stop-color="#1a7cd5"
                                                            stop-opacity=".74" />
                                                        <stop
                                                            offset="1"
                                                            stop-color="#37529c"
                                                            stop-opacity="0" />
                                                    </linearGradient>
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_19"
                                                        data-name="Unbenannter Verlauf 19"
                                                        x1="4295.4"
                                                        y1="1392.88"
                                                        x2="4304.34"
                                                        y2="1306.2"
                                                        gradientTransform="translate(1543.83 5899.22) rotate(-76.71) scale(1.22 -2.01)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop offset=".05" stop-color="#25a1ff" />
                                                        <stop
                                                            offset=".28"
                                                            stop-color="#1a7cd5"
                                                            stop-opacity=".74" />
                                                        <stop
                                                            offset="1"
                                                            stop-color="#37529c"
                                                            stop-opacity="0" />
                                                    </linearGradient>
                                                    <clipPath id="clippath-2">
                                                        <rect
                                                            id="rect62862-7"
                                                            class="cls-1"
                                                            x="133.56"
                                                            y="102.74"
                                                            width="197.49"
                                                            height="197.49"
                                                            transform="translate(-74.43 223.27) rotate(-45)" />
                                                    </clipPath>
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_18"
                                                        data-name="Unbenannter Verlauf 18"
                                                        x1="-1269.43"
                                                        y1="584.37"
                                                        x2="-1071.94"
                                                        y2="584.37"
                                                        gradientTransform="translate(1402.98 785.85) scale(1 -1)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop offset="0" stop-color="#073d84" />
                                                        <stop
                                                            offset=".84"
                                                            stop-color="#003c8b"
                                                            stop-opacity=".64" />
                                                        <stop
                                                            offset="1"
                                                            stop-color="#004eb5"
                                                            stop-opacity=".6" />
                                                    </linearGradient>
                                                    <radialGradient
                                                        id="Unbenannter_Verlauf_17"
                                                        data-name="Unbenannter Verlauf 17"
                                                        cx="322.24"
                                                        cy="482.42"
                                                        fx="322.24"
                                                        fy="482.42"
                                                        r="98.74"
                                                        gradientTransform="translate(275.77 2247.32) rotate(-4.61) scale(.69 -4.38)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop
                                                            offset="0"
                                                            stop-color="#2295ff"
                                                            stop-opacity=".65" />
                                                        <stop
                                                            offset="1"
                                                            stop-color="#2295ff"
                                                            stop-opacity="0" />
                                                    </radialGradient>
                                                    <radialGradient
                                                        id="Unbenannter_Verlauf_7"
                                                        data-name="Unbenannter Verlauf 7"
                                                        cx="774.18"
                                                        cy="435.49"
                                                        fx="774.18"
                                                        fy="435.49"
                                                        r="98.74"
                                                        gradientTransform="translate(-7732.23 487.42) rotate(16.19) scale(9.86 -6.01)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop
                                                            offset="0"
                                                            stop-color="#b34d4d"
                                                            stop-opacity="0" />
                                                        <stop offset="1" stop-color="red" />
                                                    </radialGradient>
                                                </defs>
                                                <rect
                                                    id="white_background_1"
                                                    data-name="white background 1"
                                                    class="cls-5"
                                                    x="71.91"
                                                    y="102.74"
                                                    width="197.49"
                                                    height="197.49"
                                                    transform="translate(-92.48 179.68) rotate(-45)" />
                                                <rect
                                                    id="white_background_2"
                                                    data-name="white background 2"
                                                    class="cls-5"
                                                    x="102.72"
                                                    y="102.72"
                                                    width="197.51"
                                                    height="197.51"
                                                    transform="translate(-83.46 201.48) rotate(-45)" />
                                                <rect
                                                    id="white_background_3"
                                                    data-name="white background 3"
                                                    class="cls-5"
                                                    x="133.56"
                                                    y="102.74"
                                                    width="197.49"
                                                    height="197.49"
                                                    transform="translate(-74.43 223.27) rotate(-45)" />
                                                <g class="cls-8">
                                                    <g class="cls-2">
                                                        <rect
                                                            id="rect35896-3-4-6-6-2"
                                                            class="cls-4"
                                                            x="31.36"
                                                            y="16.45"
                                                            width="279.59"
                                                            height="355.63" />
                                                        <rect
                                                            id="rect35917-90-7-5-4-2"
                                                            class="cls-12"
                                                            x="31.36"
                                                            y="39.67"
                                                            width="279.59"
                                                            height="332.41" />
                                                        <rect
                                                            id="rect35924-9-9-9-42-2"
                                                            class="cls-14"
                                                            x="-108.52"
                                                            y="62.13"
                                                            width="279.59"
                                                            height="279.59" />
                                                        <polygon
                                                            id="polygon35937-3-9-0-7-2"
                                                            class="cls-16"
                                                            points="199.72 410.27 119.89 111.41 397.36 37.26 477.25 336.06 199.72 410.27" />
                                                        <polygon
                                                            id="polygon35948-65-4-8-5-2"
                                                            class="cls-15"
                                                            points="11.85 214.45 356.22 158.86 380.63 309.84 36.25 365.42 11.85 214.45" />
                                                        <polygon
                                                            id="polygon35957-1-3-2-4-2"
                                                            class="cls-13"
                                                            points="-1.06 12.44 339.71 51.32 321.26 329.76 -19.51 290.79 -1.06 12.44" />
                                                        <rect
                                                            id="rect35968-1-9-3-10-2"
                                                            class="cls-10"
                                                            x="-7.66"
                                                            y="180.56"
                                                            width="367.25"
                                                            height="189.22" />
                                                    </g>
                                                </g>
                                                <g class="cls-9">
                                                    <g class="cls-6">
                                                        <rect
                                                            id="rect35803-7-5-9-32-2"
                                                            class="cls-4"
                                                            x="62.17"
                                                            y="16.42"
                                                            width="279.62"
                                                            height="355.67" />
                                                        <rect
                                                            id="rect35824-0-2-8-75-2"
                                                            class="cls-3"
                                                            x="62.17"
                                                            y="39.65"
                                                            width="279.62"
                                                            height="332.44" />
                                                        <rect
                                                            id="rect35826-6-7-8-5-2"
                                                            class="cls-4"
                                                            x="-24.02"
                                                            y="16.66"
                                                            width="365.51"
                                                            height="365.51" />
                                                        <rect
                                                            id="rect35843-7-8-8-7-2"
                                                            class="cls-11"
                                                            x="8.99"
                                                            y="-10.46"
                                                            width="460.61"
                                                            height="358.44" />
                                                        <path
                                                            id="path35860-8-7-6-4-2"
                                                            class="cls-17"
                                                            d="M592.99,445.31H-189.74V-260.66H592.99V445.31Z" />
                                                        <polygon
                                                            id="polygon35877-4-4-8-9-2"
                                                            class="cls-20"
                                                            points="370.32 -46.84 430.51 301.7 69.12 364.13 8.93 15.54 370.32 -46.84" />
                                                        <polygon
                                                            id="polygon35886-19-00-4-03-3"
                                                            class="cls-18"
                                                            points="57.04 4.45 397.85 34.11 371.79 347.98 32.69 246.22 57.04 4.45" />
                                                        <polygon
                                                            id="polygon35886-19-00-4-03-4"
                                                            class="cls-23"
                                                            points="-43.83 280.89 19.72 11.82 233.28 54.62 169.67 323.62 -43.83 280.89" />
                                                    </g>
                                                </g>
                                                <g class="cls-7">
                                                    <rect
                                                        id="rect62862-8"
                                                        class="cls-21"
                                                        x="133.56"
                                                        y="102.74"
                                                        width="197.49"
                                                        height="197.49"
                                                        transform="translate(-74.43 223.27) rotate(-45)" />
                                                    <rect
                                                        id="rect62862"
                                                        class="cls-22"
                                                        x="133.56"
                                                        y="102.74"
                                                        width="197.49"
                                                        height="197.49"
                                                        transform="translate(-74.43 223.27) rotate(-45)" />
                                                    <rect
                                                        id="rect62862-7-2"
                                                        data-name="rect62862-7"
                                                        class="cls-19"
                                                        x="133.56"
                                                        y="102.74"
                                                        width="197.49"
                                                        height="197.49"
                                                        transform="translate(-74.43 223.27) rotate(-45)" />
                                                </g>
                                            </svg>
                                        </div>

                                        <div
                                            slot="dark"
                                            style="width: 80px; height:80px; float:right;">
                                            <svg
                                                id="Ebene_2"
                                                data-name="Ebene 2"
                                                xmlns="http://www.w3.org/2000/svg"
                                                xmlns:xlink="http://www.w3.org/1999/xlink"
                                                viewBox="0 0 402.96 402.96">
                                                <defs>
                                                    <style>
                                                        .cls-1 {
                                                            fill: url(#Unbenannter_Verlauf_10);
                                                            opacity: 0.3;
                                                        }

                                                        .cls-2 {
                                                            fill: url(#Unbenannter_Verlauf_10-2);
                                                            opacity: 0.5;
                                                        }

                                                        .cls-3 {
                                                            fill: url(#Unbenannter_Verlauf_10-3);
                                                            opacity: 0.85;
                                                        }
                                                    </style>
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_10"
                                                        data-name="Unbenannter Verlauf 10"
                                                        x1="170.82"
                                                        y1="-1500.86"
                                                        x2="170.82"
                                                        y2="-1780.18"
                                                        gradientTransform="translate(-1109.99 1240.71) rotate(45)"
                                                        gradientUnits="userSpaceOnUse">
                                                        <stop offset=".01" stop-color="#bfbfbf" />
                                                        <stop offset=".7" stop-color="#fff" />
                                                    </linearGradient>
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_10-2"
                                                        data-name="Unbenannter Verlauf 10"
                                                        x1="201.48"
                                                        y1="-1500.86"
                                                        x2="201.48"
                                                        y2="-1780.18"
                                                        gradientTransform="translate(-1101.02 1219.03) rotate(45)"
                                                        xlink:href="#Unbenannter_Verlauf_10" />
                                                    <linearGradient
                                                        id="Unbenannter_Verlauf_10-3"
                                                        data-name="Unbenannter Verlauf 10"
                                                        x1="232.13"
                                                        y1="-1500.86"
                                                        x2="232.13"
                                                        y2="-1780.18"
                                                        gradientTransform="translate(-1092.04 1197.36) rotate(45)"
                                                        xlink:href="#Unbenannter_Verlauf_10" />
                                                </defs>
                                                <rect
                                                    class="cls-1"
                                                    x="72.06"
                                                    y="102.72"
                                                    width="197.51"
                                                    height="197.51"
                                                    transform="translate(-92.44 179.8) rotate(-45)" />
                                                <rect
                                                    class="cls-2"
                                                    x="102.72"
                                                    y="102.72"
                                                    width="197.51"
                                                    height="197.51"
                                                    transform="translate(-83.46 201.48) rotate(-45)" />
                                                <rect
                                                    class="cls-3"
                                                    x="133.38"
                                                    y="102.72"
                                                    width="197.51"
                                                    height="197.51"
                                                    transform="translate(-74.48 223.16) rotate(-45)" />
                                            </svg>
                                        </div>
                                    </dbp-themed>
                                </slot>
                            </div>
                        </slot>
                    </header>
                    <div id="headline">
                        <h1 class="title">
                            <slot name="title">
                                <a data-nav="activity-search">${this.topicMetaDataText('name')}</a>
                            </slot>
                        </h1>
                    </div>

                    <main>
                        <div
                            style="display: ${!this.metadata[this.activeView] ? 'block' : 'none'};">
                            <h2>${i18n.t('page-not-found')}</h2>
                        </div>
                        <p class="description">${this.description}</p>
                        <div class="page-container">
                            <aside class="favorite-activities-container">
                                <div class="favorite-header favorite-header--home">
                                    <h3
                                        class="favorite-header-home-title"
                                        data-nav="activity-search">
                                        Home
                                    </h3>
                                </div>
                                <div class="favorite-header">
                                    <h3 class="favorite-header-title">My Favorites</h3>
                                    <dbp-icon
                                        class="favorite-header-icon"
                                        name="star-filled"></dbp-icon>
                                </div>
                                <ul class="favorite-list">
                                    ${this.favoriteActivities.map((activity) => {
                                        return html`
                                            <li class="favorite-item is-animating">
                                                <a
                                                    data-nav="${activity.route}"
                                                    class="favorite-activity">
                                                    ${activity.name}
                                                </a>
                                            </li>
                                        `;
                                    })}
                                </ul>
                            </aside>
                            <div class="activity-container">${this._renderActivity()}</div>
                        </div>
                    </main>

                    <footer>
                        <slot name="footer">
                            <slot name="footer-links">
                                <a rel="noopener" class="" href="#use-your-privacy-policy-link">
                                    ${i18n.t('privacy-policy')}
                                </a>
                                <a rel="noopener" class="" href="#use-your-imprint-link">
                                    ${i18n.t('imprint')}
                                </a>
                                <a rel="noopener" class="" href="#use-your-imprint-link">
                                    ${i18n.t('contact')}
                                </a>
                            </slot>
                            <dbp-build-info
                                class="${prodClassMap}"
                                git-info="${this.gitInfo}"
                                env="${this.env}"
                                build-url="${this.buildUrl}"
                                build-time="${this.buildTime}"></dbp-build-info>
                        </slot>
                    </footer>
                </div>
            </div>
        `;
    }
}
