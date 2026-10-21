import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StatusBar, View } from 'react-native';
import { Text } from '@/components/typography';

import { AccessibilityProvider, useAppColorScheme } from '@/lib/accessibility';
import AppTabs from '@/components/app-tabs';
import { TravelLoading } from '@/components/travel-brand';
import Welcome from '@/components/welcome';
import SignIn from '@/components/sign-in';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useCardPaymentCapture } from '@/lib/card-payment-capture';
import { StoreProvider, useStore } from '@/lib/store';
import { TripsProvider } from '@/lib/trip-store';
import { Button, Message, Screen } from '@/components/ui';
import Sos from '@/app/sos';
import { signOut } from '@/lib/sign-out';
import { font, space, useColors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

function Root() {
  const { ready, profile, error, retry } = useStore();
  const [emergency, setEmergency] = useState(false);
  const colors = useColors();
  useCardPaymentCapture();
  useEffect(() => {
    if (ready || error) SplashScreen.hideAsync();
  }, [ready, error]);
  if (emergency) return <View style={{ flex: 1 }}><Button label="Back to Roamie" kind="secondary" onPress={() => setEmergency(false)} /><Sos /></View>;
  if (!ready && error) return <Screen title="Your saved wallet"><Message icon="exclamationmark.triangle" title="Couldn't open your wallet" body={error} action={<View style={{ gap: space.sm }}><Button label="Retry loading wallet" onPress={retry} /><Button label="Emergency help" kind="secondary" onPress={() => setEmergency(true)} /><Button label="Sign out" kind="secondary" onPress={() => void signOut()} /></View>} /></Screen>;
  if (!ready) return <TravelLoading />;
  return <View style={{ flex: 1 }}>{error && <View style={{ padding: space.md, backgroundColor: colors.warnSoft, gap: space.sm }}><Text accessibilityRole="alert" style={[font.body, { color: colors.text }]}>{error}</Text><Button label="Retry saving wallet" kind="secondary" onPress={retry} /></View>}{profile ? <AppTabs /> : <Welcome />}</View>;
}

function Account() {
  const { customer, ready } = useAuth();
  useEffect(() => { if (ready) void SplashScreen.hideAsync(); }, [ready]);
  if (!ready) return <TravelLoading />;
  if (!customer) return <SignIn />;
  return <StoreProvider key={customer.sub} accountId={customer.sub}><TripsProvider accountId={customer.sub}><Root /></TripsProvider></StoreProvider>;
}

function AppAppearance() {
  const scheme = useAppColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <AuthProvider><Account /></AuthProvider>
    </ThemeProvider>
  );
}

export default function Layout() {
  return <AccessibilityProvider><AppAppearance /></AccessibilityProvider>;
}
