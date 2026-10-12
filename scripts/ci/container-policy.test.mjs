import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('both Docker contexts exclude environment and Apple signing files', () => {
  for (const path of ['.dockerignore', 'services/travel-mcp/.dockerignore']) {
    const patterns = readFileSync(new URL('../../' + path, import.meta.url), 'utf8').split('\n');
    for (const pattern of ['**/.env', '**/.env.*', '**/*.p8', '**/*.p12', '**/*.mobileprovision']) {
      assert.ok(patterns.includes(pattern), `${path} must exclude ${pattern}`);
    }
  }
});
