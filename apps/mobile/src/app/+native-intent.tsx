export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    const url = new URL(path, 'roamie:/');
    return url.protocol === 'roamie:' && url.pathname === '/auth/callback' ? '/' : path;
  } catch { return '/'; }
}
