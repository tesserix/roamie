import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function submissionConfig(config, appId, ref) {
  if (ref !== 'refs/heads/main') throw new Error('TestFlight submissions require main.');
  if (!/^[1-9][0-9]+$/.test(appId ?? '')) throw new Error('Set Roamie’s numeric App Store Connect ID in ROAMIE_ASC_APP_ID.');
  if (config.build?.production?.distribution !== 'store' || config.build.production.autoIncrement !== true) {
    throw new Error('TestFlight requires a store build with automatic version increments.');
  }
  return { ...config, submit: { ...config.submit, production: { ...config.submit?.production, ios: { ascAppId: appId } } } };
}

export function finishedIosBuild(builds) {
  if (!Array.isArray(builds) || builds.length !== 1 || builds[0].platform !== 'IOS' || builds[0].status !== 'FINISHED' || !/^[a-f0-9-]{36}$/.test(builds[0].id ?? '')) {
    throw new Error('Expected exactly one completed iOS build from this run.');
  }
  return builds[0].id;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'configure') {
    const path = new URL('../../apps/mobile/eas.json', import.meta.url);
    const config = submissionConfig(JSON.parse(readFileSync(path, 'utf8')), process.env.ROAMIE_ASC_APP_ID, process.env.GITHUB_REF);
    writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  } else if (process.argv[2] === 'build-id') {
    process.stdout.write(finishedIosBuild(JSON.parse(readFileSync(process.argv[3], 'utf8'))));
  } else {
    throw new Error('Expected configure or build-id.');
  }
}
