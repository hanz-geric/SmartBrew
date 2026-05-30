import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, AppStateStatus, FlatList,
  Image, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useShallow } from 'zustand/react/shallow';
import { CashierStackParamList } from '../../navigation/CashierStack';
import { useAuthStore } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';
import { getProducts, getCategories } from '../../firebase/firestoreService';
import { logout, switchCashierAuth, verifyManagerAuth } from '../../firebase/auth';
import { pendingCount } from '../../db/queries/queue';
import { syncPendingOrders } from '../../services/syncService';
import {
  Category, ModifierGroup, Product, SelectedModifier,
} from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing, isTablet, rs, BREAKPOINTS,
} from '../../constants/theme';

type Props = NativeStackScreenProps<CashierStackParamList, 'POS'>;

// ─── Modifier Modal ───────────────────────────────────────────────────────────

interface ModModalProps {
  product: Product;
  onClose: () => void;
  onAdd: (mods: SelectedModifier[], qty: number, notes: string) => void;
}

function ModifierModal({ product, onClose, onAdd }: ModModalProps) {
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [qty, setQty]               = useState(1);
  const [notes, setNotes]           = useState('');
  const [errors, setErrors]         = useState<Record<string, boolean>>({});

  const modTotal = useMemo(() => {
    let total = 0;
    for (const group of product.modifier_groups) {
      for (const id of selections[group.id] ?? []) {
        const mod = group.modifiers.find((m) => m.id === id);
        if (mod) total += mod.price_delta;
      }
    }
    return total;
  }, [selections, product.modifier_groups]);

  function toggle(group: ModifierGroup, modId: string) {
    setSelections((prev) => {
      const cur = prev[group.id] ?? [];
      if (group.max_select === 1) {
        return { ...prev, [group.id]: [modId] };
      }
      if (cur.includes(modId)) {
        return { ...prev, [group.id]: cur.filter((id) => id !== modId) };
      }
      if (cur.length >= group.max_select) {
        return { ...prev, [group.id]: [...cur.slice(1), modId] };
      }
      return { ...prev, [group.id]: [...cur, modId] };
    });
    setErrors((prev) => ({ ...prev, [group.id]: false }));
  }

  function handleAdd() {
    const newErrors: Record<string, boolean> = {};
    for (const g of product.modifier_groups) {
      if (g.is_required && !(selections[g.id]?.length)) newErrors[g.id] = true;
    }
    if (Object.keys(newErrors).length) { setErrors(newErrors); return; }

    const mods: SelectedModifier[] = [];
    for (const g of product.modifier_groups) {
      for (const id of selections[g.id] ?? []) {
        const mod = g.modifiers.find((m) => m.id === id);
        if (mod) mods.push({
          modifier_id:   mod.id,
          modifier_name: mod.name,
          group_name:    g.name,
          price_delta:   mod.price_delta,
          recipe_lines:  mod.recipe_lines?.length ? mod.recipe_lines : undefined,
        });
      }
    }
    onAdd(mods, qty, notes);
  }

  const lineTotal = (product.price + modTotal) * qty;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={mm.overlay}>
        <KeyboardAvoidingView
          style={mm.sheet}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View style={mm.header}>
            <View style={{ flex: 1 }}>
              <Text style={mm.productName}>{product.name}</Text>
              <Text style={mm.productBase}>₱{product.price.toFixed(2)}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12} style={mm.closeBtn}>
              <Text style={mm.closeX}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Groups */}
          <ScrollView
            style={mm.scrollArea}
            contentContainerStyle={mm.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {product.modifier_groups.map((group) => (
              <View key={group.id} style={mm.groupBlock}>
                <View style={mm.groupHeader}>
                  <Text style={mm.groupName}>{group.name}</Text>
                  <View style={[mm.badge, errors[group.id] && mm.badgeErr]}>
                    <Text style={mm.badgeText}>
                      {group.is_required ? 'Required' : 'Optional'}
                    </Text>
                  </View>
                </View>
                <View style={mm.optionRow}>
                  {[...group.modifiers]
                    .filter((m) => m.is_active)
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((mod) => {
                      const selected = (selections[group.id] ?? []).includes(mod.id);
                      return (
                        <TouchableOpacity
                          key={mod.id}
                          style={[mm.option, selected && mm.optionSel]}
                          onPress={() => toggle(group, mod.id)}
                          activeOpacity={0.7}
                        >
                          <Text style={[mm.optionName, selected && mm.optionNameSel]}>
                            {mod.name}
                          </Text>
                          {mod.price_delta > 0 && (
                            <Text style={[mm.optionPrice, selected && mm.optionNameSel]}>
                              +₱{mod.price_delta}
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                </View>
              </View>
            ))}

            {/* Notes */}
            <View style={mm.groupBlock}>
              <Text style={mm.groupName}>Notes (optional)</Text>
              <TextInput
                style={mm.notesInput}
                placeholder="Special instructions…"
                placeholderTextColor={Colors.gray400}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={2}
              />
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={mm.footer}>
            <View style={mm.qtyRow}>
              <TouchableOpacity
                style={mm.qtyBtn}
                onPress={() => setQty((q) => Math.max(1, q - 1))}
              >
                <Text style={mm.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={mm.qtyVal}>{qty}</Text>
              <TouchableOpacity
                style={mm.qtyBtn}
                onPress={() => setQty((q) => q + 1)}
              >
                <Text style={mm.qtyBtnText}>+</Text>
              </TouchableOpacity>
              <Text style={mm.lineTotal}>₱{lineTotal.toFixed(2)}</Text>
            </View>
            <TouchableOpacity style={mm.addBtn} onPress={handleAdd} activeOpacity={0.8}>
              <Text style={mm.addBtnText}>Add to Order</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Discount Auth Modal ──────────────────────────────────────────────────────

interface DiscountAuthProps {
  onClose:   () => void;
  onSuccess: (nonce: string) => void;
}

const MAX_AUTH_ATTEMPTS = 3;

function DiscountAuthModal({ onClose, onSuccess }: DiscountAuthProps) {
  const [username,   setUsername]   = useState('');
  const [password,   setPassword]   = useState('');
  const [verifying,  setVerifying]  = useState(false);
  const [authError,  setAuthError]  = useState('');
  const [attempts,   setAttempts]   = useState(0);

  async function handleVerify() {
    setAuthError('');
    if (!username.trim() || !password) {
      setAuthError('Enter username and password.');
      return;
    }
    setVerifying(true);
    try {
      const nonce = await verifyManagerAuth(username.trim(), password);
      onSuccess(nonce);
    } catch (e: unknown) {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= MAX_AUTH_ATTEMPTS) {
        onClose();
        return;
      }
      setAuthError(`${(e as Error).message || 'Verification failed.'} (${next}/${MAX_AUTH_ATTEMPTS})`);
      setPassword('');
    } finally {
      setVerifying(false);
    }
  }

  const attemptsLeft = MAX_AUTH_ATTEMPTS - attempts;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={da.overlay}>
        <KeyboardAvoidingView
          style={da.sheet}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={da.header}>
            <Text style={da.title}>Manager Authorisation</Text>
            <Text style={da.subtitle}>A manager or admin must approve this discount.</Text>
            <TouchableOpacity onPress={onClose} style={da.closeBtn} hitSlop={12}>
              <Text style={da.closeX}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={da.body}>
            <Text style={da.fieldLabel}>Username</Text>
            <TextInput
              style={da.input}
              value={username}
              onChangeText={setUsername}
              placeholder="manager username"
              placeholderTextColor={Colors.gray400}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={da.fieldLabel}>Password</Text>
            <TextInput
              style={da.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={Colors.gray400}
              secureTextEntry
            />
            {!!authError && <Text style={da.error}>{authError}</Text>}
            {attempts > 0 && attemptsLeft > 0 && (
              <Text style={da.attemptsLeft}>{attemptsLeft} attempt{attemptsLeft !== 1 ? 's' : ''} remaining</Text>
            )}
          </View>

          <View style={da.footer}>
            <TouchableOpacity style={da.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={da.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[da.verifyBtn, verifying && da.verifyBtnOff]}
              onPress={handleVerify}
              disabled={verifying}
              activeOpacity={0.8}
            >
              {verifying
                ? <ActivityIndicator color={Colors.white} size="small" />
                : <Text style={da.verifyText}>Approve Discount</Text>
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Cashier Switch Modal ─────────────────────────────────────────────────────

interface CashierSwitchProps {
  onClose:   () => void;
  onSuccess: (user: import('../../types').AuthUser) => void;
}

function CashierSwitchModal({ onClose, onSuccess }: CashierSwitchProps) {
  const [username,  setUsername]  = useState('');
  const [password,  setPassword]  = useState('');
  const [verifying, setVerifying] = useState(false);
  const [authError, setAuthError] = useState('');
  const [attempts,  setAttempts]  = useState(0);

  async function handleSwitch() {
    setAuthError('');
    if (!username.trim() || !password) {
      setAuthError('Enter username and password.');
      return;
    }
    setVerifying(true);
    try {
      const newUser = await switchCashierAuth(username.trim(), password);
      onSuccess(newUser);
    } catch (e: unknown) {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= MAX_AUTH_ATTEMPTS) {
        onClose();
        return;
      }
      setAuthError(`${(e as Error).message || 'Verification failed.'} (${next}/${MAX_AUTH_ATTEMPTS})`);
      setPassword('');
    } finally {
      setVerifying(false);
    }
  }

  const attemptsLeft = MAX_AUTH_ATTEMPTS - attempts;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={da.overlay}>
        <KeyboardAvoidingView
          style={da.sheet}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={da.header}>
            <Text style={da.title}>Switch Cashier</Text>
            <Text style={da.subtitle}>Enter the credentials of the next cashier.</Text>
            <TouchableOpacity onPress={onClose} style={da.closeBtn} hitSlop={12}>
              <Text style={da.closeX}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={da.body}>
            <Text style={da.fieldLabel}>Username</Text>
            <TextInput
              style={da.input}
              value={username}
              onChangeText={setUsername}
              placeholder="cashier username"
              placeholderTextColor={Colors.gray400}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={da.fieldLabel}>Password</Text>
            <TextInput
              style={da.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={Colors.gray400}
              secureTextEntry
            />
            {!!authError && <Text style={da.error}>{authError}</Text>}
            {attempts > 0 && attemptsLeft > 0 && (
              <Text style={da.attemptsLeft}>{attemptsLeft} attempt{attemptsLeft !== 1 ? 's' : ''} remaining</Text>
            )}
          </View>

          <View style={da.footer}>
            <TouchableOpacity style={da.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={da.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[da.verifyBtn, verifying && da.verifyBtnOff]}
              onPress={handleSwitch}
              disabled={verifying}
              activeOpacity={0.8}
            >
              {verifying
                ? <ActivityIndicator color={Colors.white} size="small" />
                : <Text style={da.verifyText}>Switch Cashier</Text>
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Product Card ─────────────────────────────────────────────────────────────

interface ProductCardProps {
  product: Product;
  onPress: (p: Product) => void;
}

function ProductCard({ product, onPress }: ProductCardProps) {
  const isOut = product.stock_status === 'out';
  const isLow = product.stock_status === 'low';

  return (
    <TouchableOpacity
      style={[pc.card, isOut && pc.cardOut]}
      onPress={() => onPress(product)}
      disabled={isOut}
      activeOpacity={0.75}
    >
      <View style={pc.imageBox}>
        {product.image
          ? <Image source={{ uri: product.image }} style={pc.image} resizeMode="cover" />
          : <Text style={pc.imagePlaceholder}>☕</Text>
        }
      </View>
      <View style={pc.info}>
        <Text style={[pc.name, isOut && pc.nameOut]} numberOfLines={2}>{product.name}</Text>
        <Text style={pc.price}>₱{product.price.toFixed(2)}</Text>
        {isLow && <Text style={pc.low}>Low stock</Text>}
        {isOut && <Text style={pc.out}>Out of stock</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ─── POS Screen ───────────────────────────────────────────────────────────────

export default function POSScreen({ route, navigation }: Props) {
  const { session } = route.params;
  const user    = useAuthStore((s) => s.user)!;
  const setUser = useAuthStore((s) => s.setUser);

  const cartItems    = useCartStore(useShallow((s) => Object.values(s.items)));
  const total        = useCartStore((s) => s.total);
  const addItem      = useCartStore((s) => s.addItem);
  const updateQty    = useCartStore((s) => s.updateQuantity);
  const clearCart    = useCartStore((s) => s.clearCart);

  const [products,    setProducts]   = useState<Product[]>([]);
  const [categories,  setCategories] = useState<Category[]>([]);
  const [loading,     setLoading]    = useState(true);
  const [loadError,   setLoadError]  = useState(false);
  const [selCat,      setSelCat]     = useState<string | null>(null);
  const [search,      setSearch]     = useState('');
  const [modProduct,  setModProduct] = useState<Product | null>(null);
  const [queueCount,  setQueueCount] = useState(0);
  const [syncing,     setSyncing]    = useState(false);

  // Admin/manager can discount without approval; cashier needs a manager nonce
  const canDiscountFreely = user.role === 'admin' || user.role === 'manager';

  // Discount state — nonce is set after manager approves (cashier only); cleared on cart clear
  const [discountNonce,  setDiscountNonce]  = useState<string | null>(null);
  const [discountInput,  setDiscountInput]  = useState('');
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showSwitchModal,   setShowSwitchModal]   = useState(false);

  const appState = useRef(AppState.currentState);

  useEffect(() => {
    loadData();
    refreshQueueCount();

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current !== 'active' && next === 'active') {
        refreshQueueCount();
        triggerSync();
      }
      appState.current = next;
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData() {
    setLoadError(false);
    setLoading(true);
    try {
      const [prods, cats] = await Promise.all([getProducts(), getCategories()]);
      setProducts(prods);
      setCategories(cats);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function refreshQueueCount() {
    setQueueCount(await pendingCount());
  }

  async function triggerSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncPendingOrders(session, user);
    } finally {
      await refreshQueueCount();
      setSyncing(false);
    }
  }

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchCat  = selCat === null || p.category_id === selCat;
      const matchSearch = !search.trim() || p.name.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [products, selCat, search]);

  const handleProductPress = useCallback((product: Product) => {
    if (product.stock_status === 'out') return;
    if (product.modifier_groups.length > 0) {
      setModProduct(product);
    } else {
      addItem(product.id, product.name, product.price, product.cost, [], '', product.tracking_mode, product.stock_item_id, product.recipe_lines, product.needs_kitchen);
    }
  }, [addItem]);

  function handleModifierAdd(mods: SelectedModifier[], qty: number, notes: string) {
    if (!modProduct) return;
    for (let i = 0; i < qty; i++) {
      addItem(modProduct.id, modProduct.name, modProduct.price, modProduct.cost, mods, notes, modProduct.tracking_mode, modProduct.stock_item_id, modProduct.recipe_lines, modProduct.needs_kitchen);
    }
    setModProduct(null);
  }

  function clearDiscount() {
    setDiscountNonce(null);
    setDiscountInput('');
  }

  async function handleLogout() {
    if (session.status === 'open') {
      Alert.alert(
        'Session Still Open',
        'You have an open cash session. End your shift first to reconcile your cash.',
        [
          {
            text: 'End Shift',
            onPress: () => navigation.navigate('CloseSession', { session }),
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }
    clearCart();
    clearDiscount();
    await logout();
  }

  function handleCheckout() {
    if (cartItems.length === 0) return;
    const discountUnlocked = canDiscountFreely || !!discountNonce;
    const discountAmount   = discountUnlocked
      ? Math.min(parseFloat(discountInput) || 0, total)
      : 0;
    navigation.navigate('Payment', {
      session,
      total: Math.max(0, total - discountAmount),
      discountAmount: discountAmount > 0 ? discountAmount : undefined,
      discountNonce:  discountAmount > 0 && discountNonce ? discountNonce : undefined,
    });
    // Nonce is single-use — clear immediately so it cannot be reused if user backs out
    clearDiscount();
  }

  const { width: windowWidth } = useWindowDimensions();
  const numCols = windowWidth >= BREAKPOINTS.tabletLarge ? 4 : windowWidth >= BREAKPOINTS.tablet ? 3 : 2;

  const totalQty = cartItems.reduce((s, i) => s + i.quantity, 0);

  return (
    <View style={s.root}>
      {/* ── Left Panel ── */}
      <View style={s.left}>
        {/* Top bar */}
        <View style={s.topBar}>
          <View>
            <Text style={s.shopName}>☕ SmartBrew POS</Text>
            <Text style={s.sessionInfo}>
              {user.full_name} · Started{' '}
              {new Date(session.start_time).toLocaleTimeString('en-PH', {
                hour: 'numeric', minute: '2-digit', hour12: true,
              })}
              {' '}· ₱{session.starting_cash.toFixed(2)} opening cash
            </Text>
          </View>
          <View style={s.topBarActions}>
            {queueCount > 0 && (
              <TouchableOpacity
                style={[s.syncBadge, syncing && s.syncBadgeSyncing]}
                onPress={triggerSync}
                disabled={syncing}
              >
                {syncing
                  ? <ActivityIndicator size="small" color={Colors.warning} />
                  : <Text style={s.syncBadgeText}>⚠ {queueCount} pending</Text>
                }
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={s.switchBtn}
              onPress={() => setShowSwitchModal(true)}
            >
              <Text style={s.switchText}>Switch Cashier</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.endShiftBtn}
              onPress={() => navigation.navigate('CloseSession', { session })}
            >
              <Text style={s.endShiftText}>End Shift</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
              <Text style={s.logoutText}>Log out</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Category tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.catScroll}
          contentContainerStyle={s.catContent}
        >
          <TouchableOpacity
            style={[s.catTab, selCat === null && s.catTabSel]}
            onPress={() => setSelCat(null)}
          >
            <Text style={[s.catTabText, selCat === null && s.catTabTextSel]}>All</Text>
          </TouchableOpacity>
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              style={[s.catTab, selCat === cat.id && s.catTabSel]}
              onPress={() => setSelCat(cat.id)}
            >
              <Text style={[s.catTabText, selCat === cat.id && s.catTabTextSel]}>
                {cat.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Search */}
        <View style={s.searchRow}>
          <TextInput
            style={s.searchInput}
            placeholder="Search products…"
            placeholderTextColor={Colors.gray400}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {!!search && (
            <TouchableOpacity style={s.searchClear} onPress={() => setSearch('')}>
              <Text style={s.searchClearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Product grid */}
        {loading ? (
          <View style={s.loadingBox}>
            <ActivityIndicator size="large" color={Colors.green600} />
          </View>
        ) : loadError ? (
          <View style={s.loadingBox}>
            <Text style={s.loadErrorText}>Could not load products.</Text>
            <TouchableOpacity style={s.retryBtn} onPress={loadData}>
              <Text style={s.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(p) => p.id}
            numColumns={numCols}
            key={numCols}
            contentContainerStyle={s.gridContent}
            renderItem={({ item }) => (
              <ProductCard product={item} onPress={handleProductPress} />
            )}
            ListEmptyComponent={
              <View style={s.emptyBox}>
                <Text style={s.emptyText}>No products found</Text>
              </View>
            }
          />
        )}
      </View>

      {/* ── Right Panel (Cart) ── */}
      <View style={s.right}>
        {/* Cart header */}
        <View style={s.cartHeader}>
          <Text style={s.cartTitle}>
            Order {totalQty > 0 ? `(${totalQty})` : ''}
          </Text>
          {cartItems.length > 0 && (
            <TouchableOpacity
              onPress={() => Alert.alert(
                'Clear Cart',
                'Remove all items from the order?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Clear', style: 'destructive', onPress: () => { clearCart(); clearDiscount(); } },
                ],
              )}
              hitSlop={8}
            >
              <Text style={s.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Cart items */}
        <FlatList
          data={cartItems}
          keyExtractor={(i) => i.cart_key}
          style={s.cartList}
          contentContainerStyle={cartItems.length === 0 ? s.cartEmpty : undefined}
          renderItem={({ item }) => (
            <View style={s.cartRow}>
              <View style={s.cartRowInfo}>
                <Text style={s.cartRowName} numberOfLines={1}>{item.name}</Text>
                {item.modifiers.length > 0 && (
                  <Text style={s.cartRowMods} numberOfLines={1}>
                    {item.modifiers.map((m) => m.modifier_name).join(', ')}
                  </Text>
                )}
                {!!item.notes && (
                  <Text style={s.cartRowNote} numberOfLines={1}>"{item.notes}"</Text>
                )}
                <Text style={s.cartRowPrice}>
                  ₱{(item.unit_price * item.quantity).toFixed(2)}
                </Text>
              </View>
              <View style={s.qtyControl}>
                <TouchableOpacity
                  style={s.qtyMini}
                  onPress={() => updateQty(item.cart_key, item.quantity - 1)}
                >
                  <Text style={s.qtyMiniText}>−</Text>
                </TouchableOpacity>
                <Text style={s.qtyNum}>{item.quantity}</Text>
                <TouchableOpacity
                  style={s.qtyMini}
                  onPress={() => updateQty(item.cart_key, item.quantity + 1)}
                >
                  <Text style={s.qtyMiniText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <Text style={s.cartEmptyText}>No items yet.{'\n'}Tap a product to add.</Text>
          }
        />

        {/* Cart footer */}
        <View style={s.cartFooter}>
          {/* Discount row */}
          {cartItems.length > 0 && (
            (canDiscountFreely || discountNonce) ? (
              <View style={s.discountUnlocked}>
                <View style={s.discountInputRow}>
                  <Text style={s.discountPrefix}>
                    {canDiscountFreely ? '🔓 −₱' : '−₱'}
                  </Text>
                  <TextInput
                    style={s.discountInput}
                    value={discountInput}
                    onChangeText={(t) => {
                      if (t === '' || (/^\d*\.?\d*$/.test(t) && parseFloat(t) >= 0)) {
                        setDiscountInput(t);
                      }
                    }}
                    placeholder="0"
                    placeholderTextColor={Colors.gray400}
                    keyboardType="decimal-pad"
                  />
                  {!canDiscountFreely && (
                    <TouchableOpacity onPress={clearDiscount} hitSlop={8}>
                      <Text style={s.discountClear}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {parseFloat(discountInput) > 0 && (
                  <Text style={s.discountLabel}>Discount applied</Text>
                )}
              </View>
            ) : (
              <TouchableOpacity
                style={s.discountBtn}
                onPress={() => setShowDiscountModal(true)}
                activeOpacity={0.7}
              >
                <Text style={s.discountBtnText}>🔒 Apply Discount</Text>
              </TouchableOpacity>
            )
          )}

          {/* Total rows */}
          {(discountNonce || canDiscountFreely) && parseFloat(discountInput) > 0 ? (
            <>
              <View style={s.totalRow}>
                <Text style={s.totalSubLabel}>Subtotal</Text>
                <Text style={s.totalSubAmount}>₱{total.toFixed(2)}</Text>
              </View>
              <View style={s.totalRow}>
                <Text style={s.discountRowLabel}>Discount</Text>
                <Text style={s.discountRowAmount}>
                  −₱{Math.min(parseFloat(discountInput) || 0, total).toFixed(2)}
                </Text>
              </View>
              <View style={[s.totalRow, s.totalRowFinal]}>
                <Text style={s.totalLabel}>Total</Text>
                <Text style={s.totalAmount}>
                  ₱{Math.max(0, total - (parseFloat(discountInput) || 0)).toFixed(2)}
                </Text>
              </View>
            </>
          ) : (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Total</Text>
              <Text style={s.totalAmount}>₱{total.toFixed(2)}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[s.checkoutBtn, cartItems.length === 0 && s.checkoutDisabled]}
            onPress={handleCheckout}
            disabled={cartItems.length === 0}
            activeOpacity={0.8}
          >
            <Text style={s.checkoutText}>
              Checkout{totalQty > 0 ? ` (${totalQty})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Modifier Modal */}
      {modProduct && (
        <ModifierModal
          product={modProduct}
          onClose={() => setModProduct(null)}
          onAdd={handleModifierAdd}
        />
      )}

      {/* Discount Auth Modal */}
      {showDiscountModal && (
        <DiscountAuthModal
          onClose={() => setShowDiscountModal(false)}
          onSuccess={(nonce) => {
            setDiscountNonce(nonce);
            setShowDiscountModal(false);
          }}
        />
      )}

      {/* Cashier Switch Modal */}
      {showSwitchModal && (
        <CashierSwitchModal
          onClose={() => setShowSwitchModal(false)}
          onSuccess={(newUser) => {
            setUser(newUser);
            clearDiscount();
            setShowSwitchModal(false);
          }}
        />
      )}
    </View>
  );
}

// ─── POS Styles ───────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: Colors.background,
  },

  // Left panel
  left: {
    flex: 2,
    borderRightWidth: 1,
    borderColor: Colors.border,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.green700,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  shopName: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
  sessionInfo: {
    fontSize: FontSize.xs,
    color: Colors.green200,
    marginTop: 2,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.warningBg,
    borderWidth: 1,
    borderColor: '#fde68a',
    minWidth: 40,
    justifyContent: 'center',
  },
  syncBadgeSyncing: {
    opacity: 0.7,
  },
  syncBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.warning,
  },
  switchBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  switchText: {
    fontSize: FontSize.sm,
    color: Colors.green100,
    fontWeight: FontWeight.medium,
  },
  endShiftBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  endShiftText: {
    fontSize: FontSize.sm,
    color: Colors.white,
    fontWeight: FontWeight.medium,
  },
  logoutBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  logoutText: {
    fontSize: FontSize.sm,
    color: Colors.white,
    fontWeight: FontWeight.medium,
  },

  catScroll: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    flexGrow: 0,
  },
  catContent: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  catTab: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  catTabSel: {
    backgroundColor: Colors.green600,
  },
  catTabText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.gray700,
  },
  catTabTextSel: {
    color: Colors.white,
  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.gray800,
  },
  searchClear: {
    paddingHorizontal: Spacing.md,
  },
  searchClearText: {
    fontSize: FontSize.sm,
    color: Colors.gray400,
  },

  gridContent: {
    padding: Spacing.sm,
    gap: Spacing.sm,
  },
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  loadErrorText: {
    fontSize: FontSize.base,
    color: Colors.danger,
    fontWeight: FontWeight.medium,
  },
  retryBtn: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.green600,
  },
  retryBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
  emptyBox: {
    padding: Spacing.xxxl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: FontSize.base,
    color: Colors.gray400,
  },

  // Right panel
  right: {
    flex: 1,
    minWidth: isTablet ? 260 : 220,
    maxWidth: isTablet ? 340 : 280,
    backgroundColor: Colors.surface,
    flexDirection: 'column',
  },
  cartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  cartTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.gray800,
  },
  clearText: {
    fontSize: FontSize.sm,
    color: Colors.danger,
    fontWeight: FontWeight.medium,
  },
  cartList: {
    flex: 1,
  },
  cartEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  cartEmptyText: {
    textAlign: 'center',
    fontSize: FontSize.base,
    color: Colors.gray400,
    lineHeight: 22,
  },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderColor: Colors.gray100,
    gap: Spacing.sm,
  },
  cartRowInfo: {
    flex: 1,
  },
  cartRowName: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray800,
  },
  cartRowMods: {
    fontSize: FontSize.xs,
    color: Colors.gray500,
    marginTop: 1,
  },
  cartRowNote: {
    fontSize: FontSize.xs,
    color: Colors.info,
    fontStyle: 'italic',
  },
  cartRowPrice: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.green700,
    marginTop: 2,
  },
  qtyControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  qtyMini: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    backgroundColor: Colors.gray100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyMiniText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Colors.gray700,
  },
  qtyNum: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.gray800,
    minWidth: 20,
    textAlign: 'center',
  },

  cartFooter: {
    borderTopWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    ...Shadow.md,
  },

  discountBtn: {
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderRadius: Radius.sm,
    backgroundColor: Colors.gray100,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  discountBtnText: {
    fontSize: FontSize.sm,
    color: Colors.gray600,
    fontWeight: FontWeight.medium,
  },
  discountUnlocked: {
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.danger + '44',
    padding: Spacing.sm,
    gap: 2,
  },
  discountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  discountPrefix: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.danger,
  },
  discountInput: {
    flex: 1,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.danger,
    paddingVertical: 2,
  },
  discountClear: {
    fontSize: FontSize.sm,
    color: Colors.danger,
    fontWeight: FontWeight.bold,
    padding: Spacing.xs,
  },
  discountLabel: {
    fontSize: FontSize.xs,
    color: Colors.danger,
    fontWeight: FontWeight.medium,
  },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalRowFinal: {
    paddingTop: Spacing.xs,
    borderTopWidth: 1,
    borderColor: Colors.border,
    marginTop: Spacing.xs,
  },
  totalSubLabel: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
  },
  totalSubAmount: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
  },
  discountRowLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.danger,
  },
  discountRowAmount: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.danger,
  },
  totalLabel: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.gray600,
  },
  totalAmount: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
    color: Colors.gray900,
  },
  checkoutBtn: {
    backgroundColor: Colors.green600,
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  checkoutDisabled: {
    backgroundColor: Colors.gray300,
  },
  checkoutText: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
});

// ─── Product Card Styles ──────────────────────────────────────────────────────

const pc = StyleSheet.create({
  card: {
    flex: 1,
    margin: Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  cardOut: {
    opacity: 0.5,
  },
  imageBox: {
    height: isTablet ? 110 : 80,
    backgroundColor: Colors.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    fontSize: 28,
  },
  info: {
    padding: Spacing.sm,
  },
  name: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.gray800,
    lineHeight: 16,
  },
  nameOut: {
    color: Colors.gray400,
  },
  price: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.green700,
    marginTop: 2,
  },
  low: {
    fontSize: FontSize.xs,
    color: Colors.warning,
    marginTop: 2,
  },
  out: {
    fontSize: FontSize.xs,
    color: Colors.danger,
    marginTop: 2,
  },
});

// ─── Modifier Modal Styles ────────────────────────────────────────────────────

const mm = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: isTablet ? Spacing.xxl : Spacing.sm,
  },
  sheet: {
    width: '100%',
    maxWidth: isTablet ? 560 : 480,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    maxHeight: '90%',
    ...Shadow.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: isTablet ? Spacing.xl : Spacing.md,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.green700,
  },
  productName: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
  productBase: {
    fontSize: FontSize.sm,
    color: Colors.green200,
    marginTop: 2,
  },
  closeBtn: {
    marginLeft: Spacing.md,
    padding: Spacing.xs,
  },
  closeX: {
    fontSize: FontSize.lg,
    color: Colors.white,
    fontWeight: FontWeight.bold,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.xl,
    gap: Spacing.xl,
  },
  groupBlock: {
    gap: Spacing.sm,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  groupName: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray700,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
    backgroundColor: Colors.gray100,
  },
  badgeErr: {
    backgroundColor: Colors.dangerBg,
  },
  badgeText: {
    fontSize: FontSize.xs,
    color: Colors.gray600,
    fontWeight: FontWeight.medium,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  optionSel: {
    borderColor: Colors.green600,
    backgroundColor: Colors.green50,
  },
  optionName: {
    fontSize: FontSize.sm,
    color: Colors.gray700,
    fontWeight: FontWeight.medium,
  },
  optionNameSel: {
    color: Colors.green700,
    fontWeight: FontWeight.semibold,
  },
  optionPrice: {
    fontSize: FontSize.xs,
    color: Colors.gray500,
  },
  notesInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.gray800,
    minHeight: 56,
    textAlignVertical: 'top',
  },
  footer: {
    borderTopWidth: 1,
    borderColor: Colors.border,
    padding: isTablet ? Spacing.xl : Spacing.md,
    gap: Spacing.sm,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  qtyBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyBtnText: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.gray700,
  },
  qtyVal: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.gray900,
    minWidth: 28,
    textAlign: 'center',
  },
  lineTotal: {
    flex: 1,
    textAlign: 'right',
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
    color: Colors.gray900,
  },
  addBtn: {
    backgroundColor: Colors.green600,
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  addBtnText: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
});

// ─── Discount Auth Modal Styles ───────────────────────────────────────────────

const da = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  sheet: {
    width: '100%',
    maxWidth: isTablet ? 480 : 400,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    ...Shadow.lg,
  },
  header: {
    backgroundColor: Colors.green700,
    padding: isTablet ? Spacing.xl : Spacing.md,
    gap: Spacing.xs,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.green200,
  },
  closeBtn: {
    position: 'absolute',
    top: Spacing.lg,
    right: Spacing.lg,
    padding: Spacing.xs,
  },
  closeX: {
    fontSize: FontSize.lg,
    color: Colors.white,
    fontWeight: FontWeight.bold,
  },
  body: {
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  fieldLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.gray700,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: FontSize.base,
    color: Colors.gray800,
    backgroundColor: Colors.gray50,
  },
  error: {
    fontSize: FontSize.sm,
    color: Colors.danger,
    marginTop: Spacing.xs,
  },
  attemptsLeft: {
    fontSize: FontSize.xs,
    color: Colors.gray500,
    marginTop: Spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    gap: Spacing.md,
    padding: isTablet ? Spacing.xl : Spacing.md,
    paddingTop: 0,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
    color: Colors.gray600,
  },
  verifyBtn: {
    flex: 2,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.green600,
    alignItems: 'center',
    ...Shadow.sm,
  },
  verifyBtnOff: { opacity: 0.6 },
  verifyText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
});
