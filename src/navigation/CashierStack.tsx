import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SessionGateScreen    from '../screens/session/SessionGateScreen';
import CloseSessionScreen   from '../screens/session/CloseSessionScreen';
import POSScreen            from '../screens/cashier/POSScreen';
import PaymentScreen        from '../screens/cashier/PaymentScreen';
import ReceiptScreen        from '../screens/cashier/ReceiptScreen';
import PendingOrdersScreen  from '../screens/cashier/PendingOrdersScreen';
import SessionOrdersScreen  from '../screens/cashier/SessionOrdersScreen';
import PayLaterScreen       from '../screens/cashier/PayLaterScreen';
import { CashSession, Order } from '../types';

export type CashierStackParamList = {
  SessionGate:    undefined;
  CloseSession:   { session: CashSession };
  POS:            { session: CashSession; isDraft?: boolean };
  Payment:        { session: CashSession; total: number; discountAmount?: number; discountNonce?: string };
  Receipt:        { order: Order; change: number; printWarnings: string[]; session: CashSession };
  PendingOrders:  { session: CashSession };
  SessionOrders:  { session: CashSession };
  PayLater:       { session: CashSession };
};

const Stack = createNativeStackNavigator<CashierStackParamList>();

export default function CashierStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SessionGate"   component={SessionGateScreen} />
      <Stack.Screen name="CloseSession"  component={CloseSessionScreen} />
      <Stack.Screen name="POS"           component={POSScreen} />
      <Stack.Screen name="Payment"       component={PaymentScreen} />
      <Stack.Screen name="Receipt"       component={ReceiptScreen} />
      <Stack.Screen name="PendingOrders"  component={PendingOrdersScreen} />
      <Stack.Screen name="SessionOrders"  component={SessionOrdersScreen} />
      <Stack.Screen name="PayLater"       component={PayLaterScreen} />
    </Stack.Navigator>
  );
}
