import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Linking, Platform } from 'react-native';
import { AccountVerificationError, developmentAuthDisabled, authDeadline, fetchCustomer, loadAuthConfig, pendingSignIn, providersFor, session, type AuthConfig, type Customer, type NativePlatform, type Provider } from './auth-client';

WebBrowser.maybeCompleteAuthSession();
type Auth = { customer: Customer | null; ready: boolean; busy: boolean; error: string | null; config: AuthConfig | null; retry: () => Promise<void>; signIn: (provider?: Provider) => Promise<void> };
const Context = createContext<Auth | null>(null);
const REDIRECT_URI = 'roamie:/auth/callback';
const endpoints = (config: AuthConfig) => ({ authorizationEndpoint: `${config.issuer}/oauth/v2/authorize`, tokenEndpoint: `${config.issuer}/oauth/v2/token` });
const signInFailure = (error: unknown) => error instanceof AccountVerificationError ? error.message : 'Sign-in did not finish. Please try again.';

async function completeSignIn(config: AuthConfig, platform: NativePlatform, code: string, codeVerifier: string, expected: number) {
  const tokens = await authDeadline(AuthSession.exchangeCodeAsync({ clientId: config.clientIds[platform], code, redirectUri: REDIRECT_URI, extraParams: { code_verifier: codeVerifier } }, endpoints(config)));
  await session.accept(tokens, await fetchCustomer(tokens.accessToken), config, platform, expected);
}

async function resumeSignIn(config: AuthConfig, platform: NativePlatform) {
  const expected = session.revision();
  const [pending, url] = await Promise.all([pendingSignIn.take(), Linking.getInitialURL()]);
  if (expected !== session.revision() || !pending || !url || session.current() || pending.clientId !== config.clientIds[platform]) return;
  const callback = new URL(url);
  if (`${callback.protocol}${callback.host ? `//${callback.host}` : ''}${callback.pathname}` !== REDIRECT_URI) return;
  const params = callback.searchParams;
  const code = params.get('code');
  if (!code || params.get('state') !== pending.state) return;
  await completeSignIn(config, platform, code, pending.codeVerifier, expected);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const retry = useCallback(() => {
    const restore = async () => {
      if (developmentAuthDisabled()) return { current: null, failure: null };
      if (!providersFor(Platform.OS).length) return { current: null, failure: null };
      const platform = Platform.OS as NativePlatform;
      const current = await loadAuthConfig();
      try { await session.restore(current, platform); } catch { return { current, failure: 'We could not restore your session. Try again or sign in.' }; }
      try { await resumeSignIn(current, platform); } catch (error) { return { current, failure: signInFailure(error) }; }
      return { current, failure: null };
    };
    return restore().then(({ current, failure }) => {
      setConfig(current);
      setError(failure);
      setCustomer(session.current());
    }).catch(() => {
      setCustomer(null); setError('We could not connect to sign-in. Check your connection and try again.');
    }).finally(() => { setReady(true); setBusy(false); });
  }, []);
  useEffect(() => session.subscribe(() => setCustomer(session.current())), []);
  useEffect(() => { void retry(); }, [retry]);

  async function signIn(provider?: Provider) {
    if (!config || busy || !providersFor(Platform.OS).length || (provider && (!providersFor(Platform.OS).includes(provider) || !config.providers[provider]))) return;
    setBusy(true); setError(null);
    try {
      await session.clear();
      const expected = session.revision();
      const platform = Platform.OS as NativePlatform;
      const discovery = endpoints(config);
      const request = new AuthSession.AuthRequest({
        clientId: config.clientIds[platform], redirectUri: REDIRECT_URI,
        responseType: AuthSession.ResponseType.Code, usePKCE: true,
        prompt: provider ? undefined : AuthSession.Prompt.Login,
        scopes: ['openid', 'email', 'profile', 'offline_access', 'urn:zitadel:iam:user:resourceowner',
          `urn:zitadel:iam:org:id:${config.organizationId}`, `urn:zitadel:iam:org:project:id:${config.projectId}:aud`,
          ...(provider ? [`urn:zitadel:iam:org:idp:id:${config.providers[provider]}`] : [])],
      });
      const url = await request.makeAuthUrlAsync(discovery);
      if (!request.codeVerifier) throw new Error('Sign-in did not finish.');
      await pendingSignIn.save(request.state, request.codeVerifier, config.clientIds[platform]);
      const result = await request.promptAsync(discovery, { url });
      if (result.type === 'cancel' || result.type === 'dismiss') return;
      if (result.type !== 'success' || !result.params.code) throw new Error('Sign-in did not finish.');
      await completeSignIn(config, platform, result.params.code, request.codeVerifier, expected);
    } catch (error) {
      setError(signInFailure(error));
    } finally {
      await pendingSignIn.clear().catch(() => {});
      setBusy(false);
    }
  }
  return <Context.Provider value={{ customer, ready, busy, error, config, retry: async () => { setBusy(true); setError(null); await retry(); }, signIn }}>{children}</Context.Provider>;
}

export function useAuth() {
  const auth = useContext(Context);
  if (!auth) throw new Error('useAuth outside AuthProvider');
  return auth;
}
