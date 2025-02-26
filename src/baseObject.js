import DBPLitElement from '@dbp-toolkit/common/dbp-lit-element';
import {ScopedElementsMixin} from '@dbp-toolkit/common';
import {css, html, unsafeCSS} from 'lit';
import {
    DbpCheckboxElement,
    DbpDateElement,
    DbpDateTimeElement,
    DbpEnumElement,
    DbpStringElement
} from '@dbp-toolkit/form-elements';
import {createInstance} from './i18n';
import * as commonStyles from '@dbp-toolkit/common/styles';
import {classMap} from 'lit/directives/class-map.js';
import {getSelectorFixCSS} from './styles.js';
import {getIconSVGURL} from './utils.js';
import {gatherFormDataFromElement, validateRequiredFields} from '@dbp-toolkit/form-elements/src/utils.js';
import {createRef, ref} from 'lit/directives/ref.js';

export class BaseObject {
    name = 'baseObject';

    constructor() {
    }

    getHitComponent() {
        return BaseHitElement;
    }
}

export const getCommonStyles = () => css`
    .ais-doc-Hits-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 5px;
        border-bottom: 1px solid var(--dbp-override-content);
        margin-bottom: calc(7px + 1vh);
    }

    .text-container {
        display: flex;
        flex-direction: column;
        color: var(--dbp-override-content);
    }

    .icon-container {
        display: flex;
        align-items: right;
        justify-content: right;
        background-image: url("${unsafeCSS(getIconSVGURL('docs'))}");
        background-repeat: no-repeat;
        background-size: 30px;
        background-position-x: right;
        background-position-y: center;
        width: 50px;
        height: 50px;
    }

    .ais-doc-Hits-content {
        display: grid;
        grid-template-rows: repeat(3, 1fr);
    }

    .hit-content-item1 {
        grid-row: 1 / 3;
        color: var(--dbp-override-content);
        font-weight: bold;
        font-size: 24px;
    }

    .hit-content-item2 {
        grid-row: 2 / 3;
        color: var(--dbp-override-content);
    }

    .hit-content-item3 {
        grid-row: 3 / 4;
        padding-top: 30px;
        color: var(--dbp-override-content);
    }
`;

export class BaseHitElement extends ScopedElementsMixin(DBPLitElement) {
    constructor() {
        super();
        this._i18n = createInstance();
        this.lang = this._i18n.language;
        this.data = {};
    }

    static get scopedElements() {
        return {
        };
    }

    static get properties() {
        return {
            ...super.properties,
            lang: {type: String},
            data: {type: Object},
        };
    }

    static get styles() {
        // language=css
        return css`
            h2 {
                margin: 0;
                font-size: 1.2em;
            }

            ${commonStyles.getGeneralCSS(false)}
            ${commonStyles.getButtonCSS()}
        `;
    }

    render() {
        return html`
            <form>
                <h2>BaseHit</h2>
                lang: ${this.lang}<br />
        `;
    }

    update(changedProperties) {
        changedProperties.forEach((oldValue, propName) => {
            switch (propName) {
                case 'lang':
                    this._i18n.changeLanguage(this.lang);
                    break;
            }
        });

        super.update(changedProperties);
    }
}
