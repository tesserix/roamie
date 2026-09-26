import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AccessibilityProvider } from '@/lib/accessibility';
import AppTabs from '@/components/app-tabs';
import Welcome from '@/components/welcome';
import SignIn from '@/components/sign-in';
import { AuthProvider, useAuth } from '@/lib/auth';
import { StoreProvider, useStore } from '@/lib/store';
import { TripsProvider } from '@/lib/trip-store';

SplashScreen.preventAutoHideAsync();

function Root() {
  const { ready, profile } = useStore();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return profile ? <AppTabs /> : <Welcome />;
}

function Account() {
  const { customer, ready } = useAuth();
  useEffect(() => { if (ready) void SplashScreen.hideAsync(); }, [ready]);
  if (!ready) return null;
  if (!customer) return <SignIn />;
  return <StoreProvider key={customer.sub} accountId={customer.sub}><TripsProvider accountId={customer.sub}><Root /></TripsProvider></StoreProvider>;
}

export default function Layout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AccessibilityProvider><AuthProvider><Account /></AuthProvider></AccessibilityProvider>
    </ThemeProvider>
  );
}
