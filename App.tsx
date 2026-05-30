import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/firebase/config';
import { initDb } from './src/db/schema';
import RootNavigator from './src/navigation';
import { SyncProvider } from './src/context/SyncContext';
import { NetworkProvider } from './src/context/NetworkContext';

export default function App() {
  useEffect(() => {
    initDb().catch(() => {});
  }, []);

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
