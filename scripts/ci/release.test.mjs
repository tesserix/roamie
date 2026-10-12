import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTag } from './release.mjs';

test('release tags must match the API and mobile versions', () => {
  assert.equal(validateTag('v0.1.0', ['0.1.0', '0.1.0', '0.1.0']), '0.1.0');
  for (const [tag, versions] of [['latest', ['0.1.0']], ['v0.2.0', ['0.1.0']], ['v0.1.0', ['0.1.0', '1.0.0']]]) {
    assert.throws(() => validateTag(tag, versions), /release/);
  }
});
