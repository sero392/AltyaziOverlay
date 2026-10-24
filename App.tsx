import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from './src/components/ui';
import { RemotePlay } from './src/native/RemotePlay';
import { SubtitleCapture } from './src/native/SubtitleCapture';
import { HomeScreen } from './src/screens/HomeScreen';
import { SetupWizard } from './src/screens/SetupWizard';

const KEY_SETUP_DONE = 'setup_done';

/** Kurulum bitmediyse (ya da eşleşmiş PS5 yoksa) sihirbaz, sonra yönetim paneli. */
export default function App() {
  const [screen, setScreen] = useState<'loading' | 'wizard' | 'home'>(
    'loading',
  );

  useEffect(() => {
    Promise.all([
      SubtitleCapture.getSetting(KEY_SETUP_DONE),
      RemotePlay.getConsole(),
    ]).then(([done, paired]) =>
      setScreen(done === '1' || paired ? 'home' : 'wizard'),
    );
  }, []);

  const finishWizard = () => {
    SubtitleCapture.setSetting(KEY_SETUP_DONE, '1');
    setScreen('home');
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      {screen === 'loading' ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : screen === 'wizard' ? (
        <SetupWizard onDone={finishWizard} />
      ) : (
        <HomeScreen onOpenWizard={() => setScreen('wizard')} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
