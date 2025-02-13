import {assert} from 'chai';

import '../src/dbp-nexus-search';
import '../src/dbp-nexus.js';

suite('dbp-nexus-activity basics', () => {
    let node;

    suiteSetup(async () => {
        node = document.createElement('dbp-nexus-activity');
        document.body.appendChild(node);
        await node.updateComplete;
    });

    suiteTeardown(() => {
        node.remove();
    });

    test('should render', () => {
        assert(node.shadowRoot !== undefined);
    });
});
