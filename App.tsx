import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/firebase/config';
import { initDb } from './src/db/schema';
import { logError } from './src/utils/logger';
import RootNavigator from './src/navigation';
import { SyncProvider } from './src/context/SyncContext';
import { NetworkProvider } from './src/context/NetworkContext';

export default function App() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    initDb()
      .catch((err) => logError('App:initDb', err, 'SQLite initialisation failed'))
      .finally(() => setDbReady(true));
  }, []);

  if (!dbReady) return null;

  return (
    <NetworkProvider>
      <SyncProvider>
        <SafeAreaProvider>
          <StatusBar style="light" hidden={true} />
          <RootNavigator />
        </SafeAreaProvider>
      </SyncProvider>
    </NetworkProvider>
  );
}
