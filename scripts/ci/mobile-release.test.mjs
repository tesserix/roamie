import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = path => JSON.parse(readFileSync(new URL('../../' + path, import.meta.url)));
test('distributable builds require authenticated HTTPS and versioned store artifacts', () => {
  const eas = read('apps/mobile/eas.json');
  assert.equal(eas.cli.appVersionSource, 'remote');
  for (const profile of ['preview', 'production']) {
    assert.equal(eas.build[profile].env.EXPO_PUBLIC_AUTH_ENABLED, 'true');
    assert.equal(eas.build[profile].env.EXPO_PUBLIC_API_URL, 'https://roamie-api.tesserix.app');
  }
  assert.equal(eas.build.preview.android.buildType, 'apk');
  assert.equal(eas.build.production.android.buildType, 'app-bundle');
  assert.equal(eas.build.production.autoIncrement, true);
});
test('app is linked to its own Tesserix project on both platforms', () => {
  const { expo } = read('apps/mobile/app.json');
  assert.equal(expo.owner, 'tesserix-org');
  assert.equal(expo.extra.eas.projectId, '63682eea-a1b0-4b53-aa53-0873e7a88135');
  assert.equal(expo.ios.bundleIdentifier, 'app.tesserix.roamie');
  assert.equal(expo.android.package, 'app.tesserix.roamie');
});
