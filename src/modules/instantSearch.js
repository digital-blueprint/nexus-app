import {createInstance} from '../i18n.js';

export default class {
    constructor() {
        this._i18n = createInstance();
        this.lang = this._i18n.language;
    }

    /**
     * Customize facets config. These attributes are merged with the default config.
     * Each configuration object in the returned array can have the following properties:
     *
     *  filter-group: An object defining a filter group.
     *  id: A unique identifier for the filter group.
     *  name: The translation key used as title of the filter group.
     *  groupId: A name of the group ID to which the schema field belongs.
     *  schemaField: A the typesense schema field to be used for the facet.
     *  schemaFieldType: The type of the facet (e.g., "checkbox", "datepicker").
     *  facetOptions: An object containing options for the facet.
     *  facet: An object to override facet options.
     *  - facet options: https://www.algolia.com/doc/api-reference/widgets/refinement-list/js/
     *  panel: An object to override panel options.
     *  - panel options: https://www.algolia.com/doc/api-reference/widgets/panel/js/
     *  usePanel: A boolean indicating whether to use a panel for the facet (optional).
     * @returns {Array} - Array of search facets config
     */
    getFacetsConfig() {
        const showMoreLimitValue = 1000;
        return [
            { "filter-group": { "id": "category", "name": "nexus-search.type-filter-group-title"}},
            { "groupId": "category", "schemaField": "@type", "schemaFieldType": "checkbox", "facetOptions": { facet: { searchablePlaceholder: 'nexus-search.search-placeholder-person-person', searchable: false, sortBy: ['alpha:asc']}}, "usePanel": false},

            // Person properties
            { "filter-group": { "id": "person", "name": "nexus-search.person-filter-group-title"}},
            { "groupId": "person", "schemaField": "person.person", "schemaFieldType": "checkbox", "facetOptions": { facet: { searchablePlaceholder: 'nexus-search.search-placeholder-person-person',  showMore: true, showMoreLimit: showMoreLimitValue}}}
        ];
    }
}
