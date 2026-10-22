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
test('the simulator preview runs standalone without Apple signing or Metro', () => {
  const eas = read('apps/mobile/eas.json');
  assert.equal(eas.build['preview-simulator']?.extends, 'preview');
  assert.equal(eas.build['preview-simulator']?.ios?.simulator, true);
  assert.notEqual(eas.build['preview-simulator']?.developmentClient, true);
});
test('package and store versions describe the same mobile release', () => {
  assert.equal(read('apps/mobile/package.json').version, read('apps/mobile/app.json').expo.version);
});

test('Android uses user-selected media and foreground-only speech', () => {
  const { expo } = read('apps/mobile/app.json');
  for (const permission of ['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'SYSTEM_ALERT_WINDOW', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK']) {
    const full = `android.permission.${permission}`;
    assert.ok(expo.android.blockedPermissions?.includes(full), `${full} must not ship`);
    assert.ok(!expo.android.permissions.includes(full));
  }
  const audio = expo.plugins.find(p => Array.isArray(p) && p[0] === 'expo-audio')[1];
  assert.equal(audio.enableBackgroundPlayback, false);
  assert.equal(audio.enableBackgroundRecording, false);
});

test('Android store builds shrink resources and obfuscate release code', () => {
  const { expo } = read('apps/mobile/app.json');
  const properties = expo.plugins.find(p => Array.isArray(p) && p[0] === 'expo-build-properties')?.[1];
  assert.equal(properties?.android?.enableMinifyInReleaseBuilds, true);
  assert.equal(properties?.android?.enableShrinkResourcesInReleaseBuilds, true);
});
