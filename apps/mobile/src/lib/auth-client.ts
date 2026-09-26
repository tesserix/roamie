import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';

export type Provider = 'google' | 'facebook' | 'apple';
export type NativePlatform = 'ios' | 'android';
export type Customer = { sub: string; email: string; name: string };
export type AuthConfig = {
  issuer: string;
  organizationId: string;
  projectId: string;
  clientIds: Record<NativePlatform, string>;
  providers: Partial<Record<Provider, string>>;
};
type Tokens = { accessToken: string; refreshToken?: string; expiresIn?: number; issuedAt?: number };
type SavedSession = { refreshToken: string; customer: Customer; config: AuthConfig; platform: NativePlatform };
type Session = SavedSession & { accessToken: string; expiresAt: number };

export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://localhost:8080' : 'https://roamie-api.tesserix.app');
export function developmentAuthDisabled(): boolean {
  if (!__DEV__ || process.env.EXPO_PUBLIC_AUTH_ENABLED !== 'false') return false;
  const url = new URL(API_BASE);
  if (!['localhost', '127.0.0.1', '10.0.2.2', '[::1]'].includes(url.hostname)) {
    throw new Error('Login can only be disabled with a local development API.');
  }
  return true;
}
const DEVELOPMENT_CUSTOMER: Customer = { sub: 'local-development', email: 'developer@roamie.invalid', name: 'Local traveller' };
const STORAGE_KEY = 'roamie.auth.v1';
const SIGN_IN = 'Sign in to continue.';
const listeners = new Set<() => void>();
let active: Session | null = null;
let revision = 0;
let refreshing: Promise<string> | null = null;
let storageWrites: Promise<void> = Promise.resolve();

export function providersFor(platform: string): Provider[] {
  return platform === 'ios' ? ['google', 'facebook', 'apple'] : platform === 'android' ? ['google', 'facebook'] : [];
}

function queueStorage(write: () => Promise<void>): Promise<void> {
  const next = storageWrites.then(write, write);
  storageWrites = next.catch(() => {});
  return next;
}

function persist(value: Session, expected: number): Promise<void> {
  const saved: SavedSession = { refreshToken: value.refreshToken, customer: value.customer, config: value.config, platform: value.platform };
  return queueStorage(async () => {
    if (expected !== revision) throw new Error(SIGN_IN);
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(saved), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  });
}

function notify() { listeners.forEach(listener => listener()); }

export async function authDeadline<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Sign-in service timed out. Please try again.')), 15_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!__DEV__ && !API_BASE.startsWith('https://')) throw new Error('Roamie requires a secure connection.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try { return await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

export async function loadAuthConfig(): Promise<AuthConfig> {
  const response = await authFetch('/v1/auth/config');
  if (!response.ok) throw new Error('Sign-in is temporarily unavailable. Please try again.');
  const config = await response.json() as AuthConfig;
  if (config.issuer !== 'https://auth.tesserix.app' || !config.organizationId || !config.projectId ||
      !config.clientIds?.ios || !config.clientIds.android || ![config.providers?.google, config.providers?.facebook, config.providers?.apple].some(id => typeof id === 'string' && id.trim().length > 0)) {
    throw new Error('Sign-in is not configured yet. Please try again later.');
  }
  return config;
}

export async function fetchCustomer(accessToken: string): Promise<Customer> {
  const response = await authFetch('/v1/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(response.status === 403 ? 'Please verify the email on your account before continuing.' : 'We could not verify your sign-in. Please try again.');
  const customer = await response.json() as Customer;
  if (!customer.sub || !customer.email) throw new Error('We could not verify your account.');
  return customer;
}

export const session = {
  current: () => developmentAuthDisabled() ? DEVELOPMENT_CUSTOMER : active?.customer ?? null,
  revision: () => revision,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },

  async accept(tokens: Tokens, customer: Customer, config: AuthConfig, platform: NativePlatform, expected = revision) {
    if (expected !== revision) throw new Error(SIGN_IN);
    if (!tokens.accessToken || !tokens.refreshToken || !tokens.expiresIn) throw new Error('Sign-in did not provide a renewable session. Please try again.');
    const value: Session = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: (tokens.issuedAt ?? Date.now() / 1000) + tokens.expiresIn, customer, config, platform };
    await persist(value, expected);
    if (expected !== revision) throw new Error(SIGN_IN);
    active = value;
    notify();
  },

  async clear() {
    if (developmentAuthDisabled()) { notify(); return; }
    revision += 1;
    active = null;
    refreshing = null;
    notify();
    await queueStorage(() => SecureStore.deleteItemAsync(STORAGE_KEY));
  },

  accessToken(): Promise<string> {
    if (developmentAuthDisabled()) return Promise.resolve('local-development');
    if (!active) return Promise.reject(new Error(SIGN_IN));
    if (active.expiresAt > Date.now() / 1000 + 60) return Promise.resolve(active.accessToken);
    if (refreshing) return refreshing;
    const previous = active;
    const expected = revision;
    const request = (async () => {
      try {
        const tokens = await authDeadline(AuthSession.refreshAsync({ clientId: previous.config.clientIds[previous.platform], refreshToken: previous.refreshToken }, { tokenEndpoint: `${previous.config.issuer}/oauth/v2/token` }));
        if (expected !== revision) throw new Error(SIGN_IN);
        await session.accept({ ...tokens, refreshToken: tokens.refreshToken ?? previous.refreshToken }, previous.customer, previous.config, previous.platform, expected);
        return tokens.accessToken;
      } catch (error) {
        if (expected === revision && error instanceof Error && 'code' in error && error.code === 'invalid_grant') await session.clear();
        throw error;
      } finally { if (expected === revision) refreshing = null; }
    })();
    refreshing = request;
    return request;
  },

  async restore(config: AuthConfig, platform: NativePlatform) {
    const expected = revision;
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw || expected !== revision) return;
    let saved: SavedSession;
    try { saved = JSON.parse(raw) as SavedSession; } catch { await session.clear(); return; }
    if (!saved.refreshToken || !saved.customer?.sub || saved.platform !== platform || saved.config?.issuer !== config.issuer || saved.config?.clientIds?.[platform] !== config.clientIds[platform] || saved.config.organizationId !== config.organizationId || saved.config.projectId !== config.projectId) {
      await session.clear(); return;
    }
    try {
      const tokens = await authDeadline(AuthSession.refreshAsync({ clientId: config.clientIds[platform], refreshToken: saved.refreshToken }, { tokenEndpoint: `${config.issuer}/oauth/v2/token` }));
      if (expected !== revision) return;
      const renewed = { ...tokens, refreshToken: tokens.refreshToken ?? saved.refreshToken };
      await persist({ ...saved, config, ...renewed, expiresAt: 0 }, expected);
      const customer = await fetchCustomer(tokens.accessToken);
      if (expected !== revision) return;
      if (customer.sub !== saved.customer.sub) { await session.clear(); throw new Error(SIGN_IN); }
      await session.accept(renewed, customer, config, platform, expected);
    } catch (error) {
      if (expected === revision && error instanceof Error && 'code' in error && error.code === 'invalid_grant') {
        await session.clear();
        return;
      }
      if (expected === revision) { active = null; notify(); }
      throw error;
    }
  },

  async logout(): Promise<boolean> {
    const previous = active;
    await session.clear();
    if (!previous) return true;
    try {
      return await authDeadline(AuthSession.revokeAsync({ clientId: previous.config.clientIds[previous.platform], token: previous.refreshToken, tokenTypeHint: AuthSession.TokenTypeHint.RefreshToken }, { revocationEndpoint: `${previous.config.issuer}/oauth/v2/revoke` }));
    } catch { return false; }
  },
};
