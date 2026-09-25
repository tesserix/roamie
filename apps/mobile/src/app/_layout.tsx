import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import AppTabs from '@/components/app-tabs';
import Welcome from '@/components/welcome';
import { StoreProvider, useStore } from '@/lib/store';

SplashScreen.preventAutoHideAsync();

function Root() {
  const { ready, profile } = useStore();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return profile ? <AppTabs /> : <Welcome />;
}

export default function Layout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StoreProvider>
        <Root />
      </StoreProvider>
    </ThemeProvider>
  );
}
