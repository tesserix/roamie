import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateTag(tag, versions) {
  if (!/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(tag) || !versions.length || versions.some(version => version !== tag.slice(1))) {
    throw new Error('The release tag must match all product versions.');
  }
  return tag.slice(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
  const api = read('services/api/Cargo.toml').match(/^version = "([^"]+)"$/m)?.[1];
  const app = JSON.parse(read('apps/mobile/app.json')).expo.version;
  const mobile = JSON.parse(read('apps/mobile/package.json')).version;
  validateTag(process.env.GITHUB_REF_NAME, [api, app, mobile]);
}
