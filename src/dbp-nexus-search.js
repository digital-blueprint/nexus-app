import {css, html} from 'lit';
import {createRef} from 'lit/directives/ref.js';
import {ScopedElementsMixin} from '@dbp-toolkit/common';
import DBPNexusLitElement from "./dbp-nexus-lit-element.js";
import * as commonUtils from '@dbp-toolkit/common/utils';
import * as commonStyles from '@dbp-toolkit/common/styles';
import {getCurrentRefinementCSS, getSearchGridCSS, getSelectorFixCSS} from './styles.js';
import {Icon, Button, InlineNotification, Modal} from '@dbp-toolkit/common';
import {classMap} from "lit/directives/class-map.js";
import {Activity} from './activity.js';
import metadata from './dbp-nexus-search.metadata.json';
import instantsearch from 'instantsearch.js';
import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter';
import {hits, searchBox, sortBy, stats} from 'instantsearch.js/es/widgets';
import {configure} from 'instantsearch.js/es/widgets';
// import {pascalToKebab} from './utils';
import {NexusFacets} from './components/dbp-nexus-facets.js';
import {TypesenseService} from './services/typesense.js';
import {name as pkgName} from '../package.json';

class NexusSearch extends ScopedElementsMixin(DBPNexusLitElement) {
    constructor() {
        super();
        this.activity = new Activity(metadata);
        this.fuzzySearch = true;
        this.typesenseHost = '';
        this.typesensePort = '';
        this.typesensePath = '';
        this.typesenseProtocol = '';
        this.typesenseKey = '';
        this.typesenseCollection = '';
        this.typesenseNexusHost = '';
        this.typesenseNexusPort = '';
        this.typesenseNexusPath = '';
        this.typesenseNexusProtocol = '';
        this.typesenseNexusKey = '';
        this.typesenseNexusCollection = '';
        this.typesenseInstantsearchAdapter = null;
        this.typesenseService = null;
        this.serverConfig = null;

        this.hitData = {
            "id": "",
            "objectType": "",
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
            typesenseHost: { type: String, attribute: 'typesense-host' },
            typesensePort: { type: String, attribute: 'typesense-port' },
            typesensePath: { type: String, attribute: 'typesense-path' },
            typesenseProtocol: { type: String, attribute: 'typesense-protocol' },
            typesenseKey: { type: String, attribute: 'typesense-key' },
            typesenseCollection: { type: String, attribute: 'typesense-collection' },
            // Nexus
            typesenseNexusHost: { type: String, attribute: 'typesense-nexus-host' },
            typesenseNexusPort: { type: String, attribute: 'typesense-nexus-port' },
            typesenseNexusPath: { type: String, attribute: 'typesense-nexus-path' },
            typesenseNexusProtocol: { type: String, attribute: 'typesense-nexus-protocol' },
            typesenseNexusKey: { type: String, attribute: 'typesense-nexus-key' },
            typesenseNexusCollection: { type: String, attribute: 'typesense-nexus-collection' },
            hitData: { type: Object, attribute: false },
            favoriteActivities: {type: Object, attribute: false}
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
                case "auth":
                    if (!this.serverConfig) {
                        return;
                    }

                    // Update the bearer token in additional headers for the Typesense Instantsearch adapter
                    this.serverConfig.additionalHeaders = { 'Authorization': 'Bearer ' + this.auth.token };

                    // console.log('this.serverConfig auth-update', this.serverConfig);

                    // Update the Typesense Instantsearch adapter configuration with the new bearer token
                    if (this.typesenseInstantsearchAdapter) {
                        this.typesenseInstantsearchAdapter.updateConfiguration(this.getTypesenseInstantsearchAdapterConfig());
                    } else {
                        this.initInstantsearch();
                    }

                    // Init the Typesense service with the new bearer token
                    // This needs to happen after the Typesense Instantsearch adapter has been initialized,
                    // not before, or Instantsearch will break! Maybe there is some leaked stated between the two?
                    this.initTypesenseService();
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

            this.serverConfig = {
                // Be sure to use an API key that only allows searches, in production
                apiKey: this.typesenseNexusKey,
                nodes: [
                    {
                        host: this.typesenseNexusHost,
                        port: this.typesenseNexusPort,
                        path: this.typesenseNexusPath,
                        protocol: this.typesenseNexusProtocol
                    }
                ],
                additionalHeaders: {'Authorization': 'Bearer ' + this.auth.token},
                sendApiKeyAsQueryParam: true
            };
            console.log('serverConfig', this.serverConfig);

            this.loadModules();

            this.favoriteActivities = JSON.parse(localStorage.getItem('nexus-favorite-activities')) || [];
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
            // this.createPagination('#pagination-bottom'),
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

    createConfigureWidget() {
        this.configureWidget = configure({
            hitsPerPage: 24,
        });

        return this.configureWidget;
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
            ${getSelectorFixCSS()}
            ${getCurrentRefinementCSS()}
            ${getSearchGridCSS()}
        `;
    }

    /**
     * Get the search parameters for the Typesense Instantsearch adapter depending on the fuzzy search setting
     */
    getSearchParameters() {
        // https://typesense.org/docs/0.25.1/api/search.html#ranking-and-sorting-parameters
        let searchParameters = {
            query_by: "activityName",
            // query_by: "person.familyName,person.givenName,file.base.fileName,objectType,person.stPersonNr,person.studId,person.identNrObfuscated,person.birthDate",
            // @TODO we should set typo tolerance by field. ex.: birthdate or identNrObfuscated dont need typo tolerance
            // sort_by: "@type:desc,_text_match:desc,person.familyName:asc",
            // Show not-deleted documents / Show only deleted documents
            // filter_by: "base.isScheduledForDeletion:" + (this.showScheduledForDeletion ? "true" : "false"),
            // filter_by: "file.base.deleteAtTimestamp:>0",
            // filter_by: "@type:=Person || file.base.isSchedulerForDeletion:=false",
            // num_typos: "2,2,0,0,0,0,0,0",
            // group_by: "base.personGroupId",
            // group_limit: 1,
            // group_missing_values: false,
        };

        if (!this.fuzzySearch) {
            searchParameters.num_typos = "0";
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
            additionalSearchParameters: this.getSearchParameters()
        };
    }

    initTypesenseService() {
        if (!this.serverConfig || !this.typesenseNexusCollection || !this.auth.token) {
            return;
        }

        this.typesenseService = new TypesenseService(this.serverConfig, this.typesenseNexusCollection);
        // console.log('initTypesenseService this.typesenseService', this.typesenseService);
    }

    /**
     * Create the Instantsearch instance
     */
    createInstantsearch() {
        const typesenseInstantsearchAdapter = new TypesenseInstantSearchAdapter(
            this.getTypesenseInstantsearchAdapterConfig());

        // We need to leak the typesenseInstantsearchAdapter instance to the global scope,
        // so we can update the additional search parameters later
        this.typesenseInstantsearchAdapter = typesenseInstantsearchAdapter;

        // typesenseInstantsearchAdapter.typesenseClient is no Typesense.Client instance, it's a Typesense.SearchClient instance!
        const searchClient = typesenseInstantsearchAdapter.searchClient;

        let searchIndexName = this.typesenseNexusCollection;

        return instantsearch({
            searchClient,
            indexName: searchIndexName,
            future: {
                preserveSharedStateOnUnmount: true,
            },
        });
    }

    createSearchBox() {
        const i18n = this._i18n;
        const placeholderText = i18n.t('search-nexus');
        return searchBox({
            container: this._("#searchbox"),
            showLoadingIndicator: false,
            placeholder: placeholderText,
        });
    }

    // renderFavoriteActivites() {
    //     const activitiesSidebar = this._('#favorite-activities');
    //     console.log(activitiesSidebar);
    //     console.log('favoriteActivities', this.favoriteActivities);
    // }

    createHits() {
        return hits({
            container: this._("#hits"),
            escapeHTML: true,
            templates: {
                item: (hit, {html}) => {
                    // console.log('*** hit: ', hit);
                    // console.log('activityIcon', hit.activityIcon);
                    // console.log('activityIcon', html`${unsafeHTML(hit.activityIcon)}`);
                    // const icon = svg`${hit.activityIcon}`;
                    // const icon = unsafeHTML(hit.activityIcon);
                    return html`
                        <div class="activity-item">
                            <dbp-icon class="activity-favorite"
                                name="star-empty"
                                onclick="${(e) => {
                                    const icon  = e.target;
                                    // Toggle icon and favorite status
                                    if (icon.name === 'star-empty') {
                                        this.favoriteActivities.push({
                                            name: hit.activityName,
                                            route: hit.activityRoutingName
                                        });
                                        icon.name="star-filled";
                                    } else {
                                        const index = this.favoriteActivities.indexOf(hit.activityName);
                                        this.favoriteActivities.splice(index, 1);
                                        icon.name="star-empty";
                                    }
                                    // Save this.favoriteActivities to localstorage
                                    localStorage.setItem('nexus-favorite-activities', JSON.stringify(this.favoriteActivities));
                                    this.requestUpdate();
                                }}"></dbp-icon>
                            <div class="activity-header">
                                <div class="activity-icon">
                                    an-icon
                                </div>
                                <div class="activity-name">
                                    ${hit.activityName}
                                </div>
                                <div class="activity-description">
                                    ${hit.activityDescription}
                                </div>
                            </div>
                            <div class="activity-footer">
                                <div class="activity-tags">
                                    ${hit.activityTag.map(tag => {
                                        return html`<span class="activity-tag">${tag}</span>`;
                                    })}
                                </div>
                                <div class="activity-open-button">
                                    <a class="is-primary button"
                                        data-nav="${hit.activityRoutingName}"
                                        onclick="${() => {
                                            console.log('activity Clicked', hit.activityRoutingName);
                                        }}">Launch
                                    </a>
                                </div>
                            </div>
                        </div>`;
                },
            },
        });
    }

    createSortBy() {
        const i18n = this._i18n;
        const container = this._('#sort-by');
        const titleElement = document.createElement('div');
        titleElement.textContent = i18n.t('sorting :');
        titleElement.className = 'dropdown-title';
        container.insertAdjacentElement('beforebegin', titleElement);
        return sortBy({
            container: container,
            items: [
                { label: i18n.t('default-sort'), value: `${this.typesenseNexusCollection}` }, /* default sorting "@type:desc,_text_match:desc,person.familyName:asc" */
                { label: i18n.t('family-name'), value: `${this.typesenseNexusCollection}/sort/@type:desc,person.familyName:asc,_text_match:desc` },
                { label: i18n.t('last-modified-documents'), value: `${this.typesenseNexusCollection}/sort/@type:asc,file.base.modifiedTimestamp:desc,_text_match:desc` }
            ],
        });
    }

    createStats() {
        return stats({
            container: this._('#result-count'),
        });
    }

    // createPagination(id) {
    //     return pagination({
    //         container: this._(id),
    //     });
    // }

    // createFacets() {
    //     return this.nexusFacetsRef.value.createFacetsFromConfig(this.facetConfigs);
    // }

    render() {
        const i18n = this._i18n;
        const algoliaCss = commonUtils.getAssetURL(
            pkgName,
            'algolia-min.css'
        );

        console.log('-- Render --');

        return html`
            <link rel="stylesheet" href="${algoliaCss}"/>

            <div class="control ${classMap({hidden: this.isLoggedIn() || !this.isLoading() || !this.loadingTranslations })}">
                <span class="loading">
                    <dbp-mini-spinner text=${i18n.t('loading-message')}></dbp-mini-spinner>
                </span>
            </div>

            <dbp-inline-notification class=" ${classMap({hidden: this.isLoggedIn() || this.isLoading() || this.loadingTranslations})}"
                type="warning"
                body="${i18n.t('error-login-message')}">
            </dbp-inline-notification>

            <div class="main-container">
                <aside class="favorite-activities-container">
                    <h3>My Favorites</h3>
                    <ul class="favorite-list">
                        ${this.favoriteActivities.map(activity => {
                            return html`<li class="favorite-item"><a data-nav="${activity.route}" class="favorite-activity">${activity.name}</a></li>`;
                        })}
                    </ul>
                </aside>
                <div class="search-container ${classMap({hidden: !this.isLoggedIn() || this.isLoading() || this.loadingTranslations})}">

                    <div class="search-box-container">
                        <div id="searchbox" class="search-box-widget"></div>
                        <div id="sort-by" class="sort-widget"></div>
                    </div>
                    <div class="result-container">
                        <div id="result-count"></div>
                        <div class="results">
                            <div id="hits"></div>
                            <!-- <div id="pagination-bottom"></div> -->
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
