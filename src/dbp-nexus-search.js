import {css, html} from 'lit';
import {createRef} from 'lit/directives/ref.js';
import {ScopedElementsMixin} from '@dbp-toolkit/common';
import DBPNexusLitElement from './dbp-nexus-lit-element.js';
import * as commonUtils from '@dbp-toolkit/common/utils';
import * as commonStyles from '@dbp-toolkit/common/styles';
import {
    getCurrentRefinementCSS,
    getPaginationCSS,
    getSearchGridCSS,
    getSelectorFixCSS,
} from './styles.js';
import {Icon, Button, InlineNotification, Modal} from '@dbp-toolkit/common';
import {classMap} from 'lit/directives/class-map.js';
import {Activity} from './activity.js';
import metadata from './dbp-nexus-search.metadata.json';
import instantsearch from 'instantsearch.js';
import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter';
import {hits, searchBox, sortBy, stats, pagination} from 'instantsearch.js/es/widgets';
import {configure} from 'instantsearch.js/es/widgets';
// import {pascalToKebab} from './utils';
import {NexusFacets} from './components/dbp-nexus-facets.js';
import {TypesenseService} from './services/typesense.js';
import {name as pkgName} from '../package.json';

const TYPESENSE_COLLECTION = 'nexus--current';

class NexusSearch extends ScopedElementsMixin(DBPNexusLitElement) {
    constructor() {
        super();
        this.activity = new Activity(metadata);
        this.fuzzySearch = true;
        this.typesenseInstantsearchAdapter = null;
        this.typesenseService = null;
        this.serverConfig = null;

        this.hitData = {
            id: '',
            objectType: '',
        };
        this.nexusFacetsRef = createRef();
        this.instantSearchModule = {};
        this.facetConfigs = [];
        this.search = null;
        this.configureWidget = null;
        this.favoriteActivities = [];
    }

    static get scopedElements() {
        return {
            'dbp-icon': Icon,
            'dbp-modal': Modal,
            'dbp-button': Button,
            'dbp-inline-notification': InlineNotification,
            'dbp-nexus-facets': NexusFacets,
        };
    }

    static get properties() {
        return {
            ...super.properties,
            hitData: {type: Object, attribute: false},
            favoriteActivities: {type: Array, attribute: 'favorite-activities'},
        };
    }

    update(changedProperties) {
        changedProperties.forEach((oldValue, propName) => {
            switch (propName) {
                case 'lang':
                    // Refresh the search after switching the language to update hits with new language
                    if (this.search) {
                        this.search.refresh();
                    }
                    break;
                case 'auth':
                    if (!this.serverConfig) {
                        return;
                    }

                    // Update the bearer token in additional headers for the Typesense Instantsearch adapter
                    this.serverConfig.additionalHeaders = {
                        Authorization: 'Bearer ' + this.auth.token,
                    };

                    // console.log('this.serverConfig auth-update', this.serverConfig);

                    // Update the Typesense Instantsearch adapter configuration with the new bearer token
                    if (this.typesenseInstantsearchAdapter) {
                        this.typesenseInstantsearchAdapter.updateConfiguration(
                            this.getTypesenseInstantsearchAdapterConfig(),
                        );
                    } else {
                        this.initInstantsearch();
                    }

                    // Init the Typesense service with the new bearer token
                    // This needs to happen after the Typesense Instantsearch adapter has been initialized,
                    // not before, or Instantsearch will break! Maybe there is some leaked stated between the two?
                    this.initTypesenseService();
                    break;

                case 'favorite-activities':
                    this.favoriteActivities = JSON.parse(this.favoriteActivities);
                    this.requestUpdate();
                    break;
            }
        });

        super.update(changedProperties);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
    }

    connectedCallback() {
        super.connectedCallback();
        this._loginStatus = '';
        this._loginState = [];

        this.updateComplete.then(() => {
            console.log('-- updateComplete --');

            let typesenseUrl = new URL(this.entryPointUrl + '/nexus/typesense');

            this.serverConfig = {
                // Be sure to use an API key that only allows searches, in production
                apiKey: '', // unused
                nodes: [
                    {
                        host: typesenseUrl.hostname,
                        port:
                            typesenseUrl.port ||
                            (typesenseUrl.protocol === 'https:'
                                ? '443'
                                : typesenseUrl.protocol === 'http:'
                                  ? '80'
                                  : ''),
                        path: typesenseUrl.pathname,
                        protocol: typesenseUrl.protocol.replace(':', ''),
                    },
                ],
                additionalHeaders: {Authorization: 'Bearer ' + this.auth.token},
                sendApiKeyAsQueryParam: true,
            };
            console.log('serverConfig', this.serverConfig);

            this.loadModules();
        });
    }

    initInstantsearch() {
        if (!this.auth.token) {
            return;
        }

        this.search = this.createInstantsearch();
        const search = this.search;

        search.addWidgets([
            this.createConfigureWidget(),
            this.createSearchBox(),
            this.createHits(),
            this.createSortBy(),
            this.createStats(),
            this.createPagination('#pagination-bottom'),
        ]);

        // if (this.facetConfigs.length === 0) {
        //     this._('dbp-nexus-facets').remove();
        //     this._('.result-container').classList.add('no-facets');
        // }

        // if (this.facetConfigs.length > 0 && this.search) {
        //     search.addWidgets(
        //         this.createFacets()
        //     );
        // }

        search.start();

        search.on('render', () => {
            // Handle gradients display on facets.
            // this.nexusFacetsRef.value.handleGradientDisplay();
            // this.nexusFacetsRef.value.hideFilterGroupIfEmpty();
        });

        // TODO: Improve on workaround to show hits after the page loads
        setTimeout(() => {
            this._('input.ais-SearchBox-input').value = ' ';
            search.refresh();
        }, 1000);
    }

    static get styles() {
        // language=css
        return css`
            ${commonStyles.getThemeCSS()}
            ${commonStyles.getGeneralCSS(false)}
            ${commonStyles.getButtonCSS()}
            ${commonStyles.getLinkCss()}
            ${commonStyles.getNotificationCSS()}
            ${commonStyles.getActivityCSS()}
            ${commonStyles.getRadioAndCheckboxCss()}
            ${commonStyles.getFormAddonsCSS()}
            ${getPaginationCSS()}
            ${getSelectorFixCSS()}
            ${getCurrentRefinementCSS()}
            ${getSearchGridCSS()}
        `;
    }

    createConfigureWidget() {
        this.configureWidget = configure({
            hitsPerPage: 12,
        });

        return this.configureWidget;
    }

    /**
     * Get the search parameters for the Typesense Instantsearch adapter depending on the fuzzy search setting
     */
    getSearchParameters() {
        // https://typesense.org/docs/0.25.1/api/search.html#ranking-and-sorting-parameters
        let searchParameters = {
            query_by: 'activityName,activityTag',
            page: 1,
            sort_by: 'activityName:asc',
        };

        if (!this.fuzzySearch) {
            searchParameters.num_typos = '0';
            searchParameters.typo_tokens_threshold = 0;
        }

        return searchParameters;
    }

    /**
     * Get the config for the Typesense Instantsearch adapter depending on the fuzzy search setting
     */
    getTypesenseInstantsearchAdapterConfig() {
        return {
            server: this.serverConfig,
            additionalSearchParameters: this.getSearchParameters(),
        };
    }

    initTypesenseService() {
        if (!this.serverConfig || !this.auth.token) {
            return;
        }

        this.typesenseService = new TypesenseService(this.serverConfig, TYPESENSE_COLLECTION);
        // console.log('initTypesenseService this.typesenseService', this.typesenseService);
    }

    /**
     * Create the Instantsearch instance
     */
    createInstantsearch() {
        const typesenseInstantsearchAdapter = new TypesenseInstantSearchAdapter(
            this.getTypesenseInstantsearchAdapterConfig(),
        );

        // We need to leak the typesenseInstantsearchAdapter instance to the global scope,
        // so we can update the additional search parameters later
        this.typesenseInstantsearchAdapter = typesenseInstantsearchAdapter;

        // typesenseInstantsearchAdapter.typesenseClient is no Typesense.Client instance, it's a Typesense.SearchClient instance!
        const searchClient = typesenseInstantsearchAdapter.searchClient;

        return instantsearch({
            searchClient,
            indexName: TYPESENSE_COLLECTION,
            future: {
                preserveSharedStateOnUnmount: true,
            },
        });
    }

    createSearchBox() {
        const i18n = this._i18n;
        const placeholderText = i18n.t('search-nexus');
        return searchBox({
            container: this._('#searchbox'),
            showLoadingIndicator: false,
            placeholder: placeholderText,
        });
    }

    createHits() {
        return hits({
            container: this._('#hits'),
            escapeHTML: true,
            templates: {
                item: (hit, {html}) => {
                    const isFavorite = this.favoriteActivities.some(
                        (item) => item.name === hit.activityName,
                    );
                    return html`
                        <div class="activity-item">
                            <dbp-icon
                                class="activity-favorite"
                                name="${isFavorite ? 'star-filled' : 'star-empty'}"
                                onclick="${(e) => {
                                    const icon = e.target;
                                    icon.classList.add('is-animating');
                                    setTimeout(() => {
                                        icon.classList.remove('is-animating');
                                    }, 250);
                                    this.dispatchEvent(
                                        new CustomEvent('dbp-favorized', {
                                            bubbles: true,
                                            composed: true,
                                            detail: {
                                                icon: icon,
                                                activityName: hit.activityName,
                                                activityRoute: hit.activityRoutingName,
                                            },
                                        }),
                                    );
                                }}"></dbp-icon>
                            <div class="activity-header">
                                <div class="activity-icon">an-icon</div>
                                <div class="activity-name">${hit.activityName}</div>
                                <div class="activity-description">${hit.activityDescription}</div>
                            </div>
                            <div class="activity-footer">
                                <div class="activity-tags">
                                    ${hit.activityTag.map((tag) => {
                                        return html`
                                            <span class="activity-tag">${tag}</span>
                                        `;
                                    })}
                                </div>
                                <div class="activity-open-button">
                                    <a
                                        class="is-primary button"
                                        data-nav="${hit.activityRoutingName}"
                                        onclick="${() => {
                                            console.log(
                                                'activity Clicked',
                                                hit.activityRoutingName,
                                            );
                                        }}">
                                        Launch
                                    </a>
                                </div>
                            </div>
                        </div>
                    `;
                },
            },
        });
    }

    createSortBy() {
        const i18n = this._i18n;
        const container = this._('#sort-by');
        const titleElement = document.createElement('div');
        titleElement.textContent = '⇅';
        titleElement.className = 'dropdown-title';
        container.insertAdjacentElement('beforebegin', titleElement);
        return sortBy({
            container: container,
            items: [
                {label: i18n.t('A-Z'), value: `${TYPESENSE_COLLECTION}`},
                {label: i18n.t('Z-A'), value: `${TYPESENSE_COLLECTION}/sort/activityName:desc`},
            ],
        });
    }

    createStats() {
        return stats({
            container: this._('#result-count'),
        });
    }

    createPagination(id) {
        return pagination({
            container: this._(id),
        });
    }

    // createFacets() {
    //     return this.nexusFacetsRef.value.createFacetsFromConfig(this.facetConfigs);
    // }

    render() {
        const i18n = this._i18n;
        const algoliaCss = commonUtils.getAssetURL(pkgName, 'algolia-min.css');

        console.log('-- Render --');

        return html`
            <link rel="stylesheet" href="${algoliaCss}" />

            <div
                class="control ${classMap({
                    hidden: this.isLoggedIn() || !this.isLoading() || !this.loadingTranslations,
                })}">
                <span class="loading">
                    <dbp-mini-spinner text=${i18n.t('loading-message')}></dbp-mini-spinner>
                </span>
            </div>

            <dbp-inline-notification
                class=" ${classMap({
                    hidden: this.isLoggedIn() || this.isLoading() || this.loadingTranslations,
                })}"
                type="warning"
                body="${i18n.t('error-login-message')}"></dbp-inline-notification>

            <div class="main-container">
                <div
                    class="search-container ${classMap({
                        hidden: !this.isLoggedIn() || this.isLoading() || this.loadingTranslations,
                    })}">
                    <div class="search-box-container">
                        <div id="searchbox" class="search-box-widget"></div>
                        <div id="sort-by" class="sort-widget"></div>
                    </div>
                    <div class="result-container">
                        <div id="result-count" class="result-count"></div>
                        <div class="results">
                            <div id="hits"></div>
                            <div id="pagination-bottom"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async loadModules() {
        try {
            // Fetch the JSON file containing module paths
            const response = await fetch(this.basePath + 'nexus-modules.json');
            const data = await response.json();
            console.log('data', data);

            // const instantSearchModule = await import(data["instantSearch"]);
            // this.instantSearchModule = new instantSearchModule.default();
            // this.facetConfigs = this.instantSearchModule.getFacetsConfig();

            this.initInstantsearch();
            this.initTypesenseService();
        } catch (error) {
            console.error('Error loading modules:', error);
        }
    }
}

commonUtils.defineCustomElement('dbp-nexus-search', NexusSearch);
