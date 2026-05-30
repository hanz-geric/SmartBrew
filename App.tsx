import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/firebase/config';
import { initDb } from './src/db/schema';
import RootNavigator from './src/navigation';

export default function App() {
  useEffect(() => {
    initDb().catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" hidden={true} />
      <RootNavigator />
    </SafeAreaProvider>
  );
}
