import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { onAuthChanged } from '../firebase/auth';
import { useAuthStore } from '../store/authStore';
import AuthStack    from './AuthStack';
import CashierStack from './CashierStack';
import AdminStack   from './AdminStack';
import { Colors } from '../constants/theme';

export default function RootNavigator() {
  const { user, isLoading, setUser } = useAuthStore();

  useEffect(() => {
    const unsubscribe = onAuthChanged(setUser);
    return unsubscribe;
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.green700 }}>
        <ActivityIndicator size="large" color={Colors.white} />
      </View>
    );
  }

  let AppStack: React.ComponentType | null = null;
  if (user) {
    AppStack = user.role === 'cashier' ? CashierStack : AdminStack;
  }

  return (
    <NavigationContainer>
      {AppStack ? <AppStack /> : <AuthStack />}
    </NavigationContainer>
  );
}
