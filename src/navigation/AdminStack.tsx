import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DashboardScreen       from '../screens/admin/DashboardScreen';
import OrderHistoryScreen    from '../screens/admin/OrderHistoryScreen';
import SessionsScreen        from '../screens/admin/SessionsScreen';
import SettingsScreen        from '../screens/admin/SettingsScreen';
import ProductsScreen        from '../screens/admin/ProductsScreen';
import ProductEditScreen     from '../screens/admin/ProductEditScreen';
import CategoryEditScreen    from '../screens/admin/CategoryEditScreen';
import ModifiersScreen        from '../screens/admin/ModifiersScreen';
import ModifierGroupEditScreen from '../screens/admin/ModifierGroupEditScreen';
import UsersScreen             from '../screens/admin/UsersScreen';
import UserEditScreen          from '../screens/admin/UserEditScreen';
import StockScreen             from '../screens/admin/StockScreen';
import StockEditScreen         from '../screens/admin/StockEditScreen';

export type AdminStackParamList = {
  Dashboard:         undefined;
  Orders:            undefined;
  Sessions:          undefined;
  Settings:          undefined;
  Products:          undefined;
  ProductEdit:       { productId?: string };
  CategoryEdit:      { categoryId?: string };
  Modifiers:         undefined;
  ModifierGroupEdit: { groupId?: string };
  Stock:             undefined;
  StockEdit:         { itemId?: string };
  Users:             undefined;
  UserEdit:          { userId?: string };
};

const Stack = createNativeStackNavigator<AdminStackParamList>();

export default function AdminStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Screen name="Dashboard"         component={DashboardScreen} />
      <Stack.Screen name="Orders"            component={OrderHistoryScreen} />
      <Stack.Screen name="Sessions"          component={SessionsScreen} />
      <Stack.Screen name="Settings"          component={SettingsScreen} />
      <Stack.Screen name="Products"          component={ProductsScreen} />
      <Stack.Screen name="ProductEdit"       component={ProductEditScreen} />
      <Stack.Screen name="CategoryEdit"      component={CategoryEditScreen} />
      <Stack.Screen name="Modifiers"         component={ModifiersScreen} />
      <Stack.Screen name="ModifierGroupEdit" component={ModifierGroupEditScreen} />
      <Stack.Screen name="Stock"             component={StockScreen} />
      <Stack.Screen name="StockEdit"         component={StockEditScreen} />
      <Stack.Screen name="Users"             component={UsersScreen} />
      <Stack.Screen name="UserEdit"          component={UserEditScreen} />
    </Stack.Navigator>
  );
}
