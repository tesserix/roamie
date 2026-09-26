import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { developmentAuthDisabled, authDeadline, fetchCustomer, loadAuthConfig, providersFor, session, type AuthConfig, type Customer, type NativePlatform, type Provider } from './auth-client';

WebBrowser.maybeCompleteAuthSession();
type Auth = { customer: Customer | null; ready: boolean; busy: boolean; error: string | null; config: AuthConfig | null; retry: () => Promise<void>; signIn: (provider: Provider) => Promise<void> };
const Context = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const retry = useCallback(() => {
    const restore = async () => {
      if (developmentAuthDisabled()) return { current: null, restoreFailed: false };
      if (!providersFor(Platform.OS).length) return { current: null, restoreFailed: false };
      const current = await loadAuthConfig();
      try {
        await session.restore(current, Platform.OS as NativePlatform);
        return { current, restoreFailed: false };
      } catch { return { current, restoreFailed: true }; }
    };
    return restore().then(({ current, restoreFailed }) => {
      setConfig(current);
      setError(restoreFailed ? 'We could not restore your session. Try again or sign in.' : null);
      setCustomer(session.current());
    }).catch(() => {
      setCustomer(null); setError('We could not connect to sign-in. Check your connection and try again.');
    }).finally(() => { setReady(true); setBusy(false); });
  }, []);
  useEffect(() => session.subscribe(() => setCustomer(session.current())), []);
  useEffect(() => { void retry(); }, [retry]);

  async function signIn(provider: Provider) {
    if (!config || busy || !providersFor(Platform.OS).includes(provider) || !config.providers[provider]) return;
    setBusy(true); setError(null);
    try {
      await session.clear();
      const expected = session.revision();
      const platform = Platform.OS as NativePlatform;
      const redirectUri = 'roamie:/auth/callback';
      const discovery = { authorizationEndpoint: `${config.issuer}/oauth/v2/authorize`, tokenEndpoint: `${config.issuer}/oauth/v2/token` };
      const request = new AuthSession.AuthRequest({
        clientId: config.clientIds[platform], redirectUri,
        responseType: AuthSession.ResponseType.Code, usePKCE: true,
        scopes: ['openid', 'email', 'profile', 'offline_access', 'urn:zitadel:iam:user:resourceowner',
          `urn:zitadel:iam:org:id:${config.organizationId}`, `urn:zitadel:iam:org:project:id:${config.projectId}:aud`,
          `urn:zitadel:iam:org:idp:id:${config.providers[provider]}`],
        prompt: AuthSession.Prompt.Login,
      });
      const result = await request.promptAsync(discovery);
      if (result.type === 'cancel' || result.type === 'dismiss') return;
      if (result.type !== 'success' || !result.params.code || !request.codeVerifier) throw new Error('Sign-in did not finish.');
      const tokens = await authDeadline(AuthSession.exchangeCodeAsync({ clientId: config.clientIds[platform], code: result.params.code, redirectUri, extraParams: { code_verifier: request.codeVerifier } }, discovery));
      await session.accept(tokens, await fetchCustomer(tokens.accessToken), config, platform, expected);
    } catch (error) {
      setError(error instanceof Error && error.message.startsWith('Please verify') ? error.message : 'Sign-in did not finish. Please try again.');
    } finally { setBusy(false); }
  }
  return <Context.Provider value={{ customer, ready, busy, error, config, retry: async () => { setBusy(true); setError(null); await retry(); }, signIn }}>{children}</Context.Provider>;
}

export function useAuth() {
  const auth = useContext(Context);
  if (!auth) throw new Error('useAuth outside AuthProvider');
  return auth;
}
