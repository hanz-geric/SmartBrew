import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { onAuthChanged, logout } from '../firebase/auth';
import { useAuthStore } from '../store/authStore';
import AuthStack    from './AuthStack';
import CashierStack from './CashierStack';
import AdminStack   from './AdminStack';
import ErrorBoundary from '../components/ErrorBoundary';
import { LoadingState } from '../components/ui';
import { Colors } from '../constants/theme';

export default function RootNavigator() {
  const { user, isLoading, setUser } = useAuthStore();

  useEffect(() => {
    let coldStart = true;
    const unsubscribe = onAuthChanged((user) => {
      // On the very first auth event (cold launch / app killed + restarted),
      // admin and manager sessions must not auto-restore — require fresh login.
      // Cashier sessions are allowed to persist for offline/register continuity.
      if (coldStart && user && user.role !== 'cashier') {
        coldStart = false;
        logout(); // clears auth cache + Firebase session → next event fires with null
        return;
      }
      coldStart = false;
      setUser(user);
    });
    return unsubscribe;
  }, []);

  if (isLoading) {
    return <LoadingState fill color={Colors.white} style={{ backgroundColor: Colors.green700 }} />;
  }

  let AppStack: React.ComponentType | null = null;
  if (user) {
    AppStack = user.role === 'cashier' ? CashierStack : AdminStack;
  }

  return (
    <NavigationContainer>
      <ErrorBoundary tag="AppStack">
        {AppStack ? <AppStack /> : <AuthStack />}
      </ErrorBoundary>
    </NavigationContainer>
  );
}
