import '@webcomponents/scoped-custom-element-registry';
import {NexusAppShell} from './dbp-nexus-app-shell.js';
import * as commonUtils from '@dbp-toolkit/common/utils';
import {Translated} from '@dbp-toolkit/common/src/translated';
import {Translation} from '@dbp-toolkit/common/src/translation';

commonUtils.defineCustomElement('dbp-nexus', NexusAppShell);
commonUtils.defineCustomElement('dbp-translated', Translated);
commonUtils.defineCustomElement('dbp-translation', Translation);
