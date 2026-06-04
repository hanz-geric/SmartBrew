import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Asset } from 'expo-asset';
import './src/firebase/config';
import { initDb } from './src/db/schema';
import { logError } from './src/utils/logger';
import RootNavigator from './src/navigation';
import ErrorBoundary from './src/components/ErrorBoundary';
import { ToastProvider } from './src/components/ui';
import { SyncProvider } from './src/context/SyncContext';
import { NetworkProvider } from './src/context/NetworkContext';

const PRELOAD_ASSETS = [
  require('./assets/images/SmartBrew_logo.jpg'),
];

export default function App() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    Promise.all([
      initDb().catch((err) => logError('App:initDb', err, 'SQLite initialisation failed')),
      Asset.loadAsync(PRELOAD_ASSETS).catch(() => {}),
    ]).finally(() => setDbReady(true));
  }, []);

  if (!dbReady) return null;

  return (
    <ErrorBoundary tag="App">
      <NetworkProvider>
        <SyncProvider>
          <SafeAreaProvider>
            <StatusBar style="light" hidden={true} />
            <ToastProvider>
              <RootNavigator />
            </ToastProvider>
          </SafeAreaProvider>
        </SyncProvider>
      </NetworkProvider>
    </ErrorBoundary>
  );
}
