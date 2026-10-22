import assert from 'node:assert/strict';
import test from 'node:test';
import { submissionConfig, finishedIosBuild } from './testflight.mjs';

test('TestFlight requires main and the real numeric App Store Connect ID', () => {
  const config = { build: { production: { distribution: 'store', autoIncrement: true } } };
  assert.throws(() => submissionConfig(config, '', 'refs/heads/main'), /App Store Connect/);
  assert.throws(() => submissionConfig(config, '1234567890', 'refs/heads/feature'), /main/);
  assert.deepEqual(submissionConfig(config, '1234567890', 'refs/heads/main').submit.production.ios, { ascAppId: '1234567890' });
});

test('submission uses only the exact completed iOS build from this run', () => {
  const build = { id: '123e4567-e89b-42d3-a456-426614174000', platform: 'IOS', status: 'FINISHED' };
  assert.equal(finishedIosBuild([build]), build.id);
  for (const value of [[], [build, build], [{ ...build, status: 'ERRORED' }], [{ ...build, platform: 'ANDROID' }]]) {
    assert.throws(() => finishedIosBuild(value), /completed iOS build/);
  }
});
