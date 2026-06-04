import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, AppState, AppStateStatus, FlatList,
  Image, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback,
  View, useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useShallow } from 'zustand/react/shallow';
import { CashierStackParamList } from '../../navigation/CashierStack';
import { useAuthStore } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';
import {
  getProducts, getCategories,
  addCashierToRoster, clockOutCashierEntry, switchActiveCashier,
  getUnpaidOrdersBySession,
} from '../../firebase/firestoreService';
import { switchCashierAuth, verifyManagerAuth } from '../../firebase/auth';
import { savePendingCashierSync, loadPendingCashierSync } from '../../db/queries/sessionCache';
import { AppModal, PinKeypad, UsernameDropdown } from '../../components/ui';
import { pendingCount } from '../../db/queries/queue';
import { syncPendingOrders, reconcileDraftSession, syncPendingClose } from '../../services/syncService';
import { useSyncEvents } from '../../context/SyncContext';
import { useNetwork } from '../../context/NetworkContext';
import { logError } from '../../utils/logger';
import { getCatalogAge } from '../../db/queries/catalog';
import {
  AuthUser, CashierEvent, Category, ModifierGroup, Product,
  RosterEntry, SelectedModifier,
} from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing, isTablet, rs, BREAKPOINTS,
} from '../../constants/theme';

type Props = NativeStackScreenProps<CashierStackParamList, 'POS'>;


const CARD_TARGET_WIDTH = 100; // dp — target card width for dynamic column calculation

function rosterInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── Modifier Modal ───────────────────────────────────────────────────────────

interface ModModalProps {
  product: Product;
  onClose: () => void;
  onAdd: (mods: SelectedModifier[], qty: number) => void;
}

function ModifierModal({ product, onClose, onAdd }: ModModalProps) {
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [qty, setQty]               = useState(1);
  const [errors, setErrors]         = useState<Record<string, boolean>>({});
  const translateY                  = useRef(new Animated.Value(700)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: 0,
      tension: 65,
      friction: 11,
      useNativeDriver: true,
    }).start();
  }, [translateY]);

  const slideClose = useCallback((cb: () => void) => {
    Animated.timing(translateY, {
      toValue: 700,
      duration: 220,
      useNativeDriver: true,
    }).start(() => cb());
  }, [translateY]);

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
      const hasActive = g.modifiers.some((m) => m.is_active !== false);
      if (g.is_required && hasActive && !(selections[g.id]?.length)) newErrors[g.id] = true;
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
    slideClose(() => onAdd(mods, qty));
  }

  const lineTotal = (product.price + modTotal) * qty;

  return (
    <Modal transparent animationType="none" onRequestClose={() => slideClose(onClose)}>
      <KeyboardAvoidingView
        style={mm.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Backdrop — tap to dismiss */}
        <TouchableWithoutFeedback onPress={() => slideClose(onClose)}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        {/* Bottom sheet */}
        <Animated.View style={[mm.sheet, { transform: [{ translateY }] }]}>
          {/* Drag handle */}
          <View style={mm.handle} />

          {/* Header */}
          <View style={mm.header}>
            <View style={{ flex: 1 }}>
              <Text style={mm.productName}>{product.name}</Text>
              <Text style={mm.productBase}>₱{product.price.toFixed(2)}</Text>
            </View>
            <TouchableOpacity onPress={() => slideClose(onClose)} hitSlop={12} style={mm.closeBtn}>
              <Text style={mm.closeX}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Groups + Notes */}
          <ScrollView
            style={mm.scrollArea}
            contentContainerStyle={mm.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {product.modifier_groups.filter((group) =>
              group.modifiers.some((m) => m.is_active !== false)
            ).map((group) => (
              <View key={group.id} style={mm.groupBlock}>
                <View style={mm.groupHeader}>
                  <Text style={mm.groupName}>{group.name}</Text>
                  <View style={[mm.badge, errors[group.id] && mm.badgeErr]}>
                    <Text style={[mm.badgeText, errors[group.id] && mm.badgeTextErr]}>
                      {errors[group.id] ? '⚠ Required' : group.is_required ? 'Required' : 'Optional'}
                    </Text>
                  </View>
                </View>
                <View style={mm.optionRow}>
                  {[...group.modifiers]
                    .filter((m) => m.is_active !== false)
                    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
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
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Discount Auth Panel (inline, left panel) ────────────────────────────────

interface DiscountAuthPanelProps {
  onClose:              () => void;
  onSuccess:            (nonce: string, type: 'percent' | 'amount', input: string) => void;
  isOnline:             boolean;
  initialDiscountType:  'percent' | 'amount';
  initialDiscountInput: string;
  cartSubtotal:         number;
}

const MAX_AUTH_ATTEMPTS = 3;

function DiscountAuthPanel({
  onClose, onSuccess, isOnline,
  initialDiscountType, initialDiscountInput, cartSubtotal,
}: DiscountAuthPanelProps) {
  const [username,     setUsername]     = useState('');
  const [pin,          setPin]          = useState('');
  const [verifying,    setVerifying]    = useState(false);
  const [authError,    setAuthError]    = useState('');
  const [attempts,     setAttempts]     = useState(0);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>(initialDiscountType);
  const [discountAmt,  setDiscountAmt]  = useState(initialDiscountInput);

  const attemptsLeft  = MAX_AUTH_ATTEMPTS - attempts;
  const rawNum        = parseFloat(discountAmt) || 0;
  const discountPesos = discountType === 'percent'
    ? Math.min((rawNum / 100) * cartSubtotal, cartSubtotal)
    : Math.min(rawNum, cartSubtotal);

  async function handleVerify(completedPin?: string) {
    const pwd = completedPin ?? pin;
    setAuthError('');
    if (!username.trim() || pwd.length < 6) {
      setAuthError('Enter username and 6-digit PIN.');
      setPin('');
      return;
    }
    setVerifying(true);
    try {
      const nonce = await verifyManagerAuth(username.trim(), pwd, isOnline);
      onSuccess(nonce, discountType, discountAmt);
    } catch (e: unknown) {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= MAX_AUTH_ATTEMPTS) {
        onClose();
        return;
      }
      setAuthError(`${(e as Error).message || 'Verification failed.'} (${next}/${MAX_AUTH_ATTEMPTS})`);
      setPin('');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <ScrollView
      style={ap.container}
      contentContainerStyle={ap.content}
      keyboardShouldPersistTaps="handled"
      bounces={false}
    >
      <View style={ap.titleRow}>
        <Text style={ap.title}>Manager Authorisation</Text>
        <TouchableOpacity onPress={onClose} hitSlop={12}>
          <Text style={ap.closeX}>✕</Text>
        </TouchableOpacity>
      </View>

      <Text style={ap.subtitle}>A manager or admin must approve this discount.</Text>

      <Text style={ap.fieldLabel}>Discount Amount</Text>
      <View style={ap.discountTypeRow}>
        <TouchableOpacity
          style={[ap.discountTypeBtn, discountType === 'percent' && ap.discountTypeBtnSel]}
          onPress={() => setDiscountType('percent')}
          activeOpacity={0.7}
        >
          <Text style={[ap.discountTypeBtnText, discountType === 'percent' && ap.discountTypeBtnTextSel]}>%</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[ap.discountTypeBtn, discountType === 'amount' && ap.discountTypeBtnSel]}
          onPress={() => setDiscountType('amount')}
          activeOpacity={0.7}
        >
          <Text style={[ap.discountTypeBtnText, discountType === 'amount' && ap.discountTypeBtnTextSel]}>₱</Text>
        </TouchableOpacity>
      </View>
      <View style={ap.discountInputRow}>
        <Text style={ap.discountInputPrefix}>−</Text>
        <TextInput
          style={ap.discountInputField}
          value={discountAmt}
          onChangeText={(t) => {
            if (t === '' || /^\d*\.?\d*$/.test(t)) {
              if (discountType === 'percent' && parseFloat(t) > 100) return;
              setDiscountAmt(t);
            }
          }}
          placeholder="0"
          placeholderTextColor={Colors.gray400}
          keyboardType="decimal-pad"
        />
        <Text style={ap.discountInputSuffix}>{discountType === 'percent' ? '%' : '₱'}</Text>
      </View>
      {rawNum > 0 && (
        <Text style={ap.discountPreview}>= −₱{discountPesos.toFixed(2)} off</Text>
      )}

      <Text style={ap.fieldLabel}>Username</Text>
      <UsernameDropdown
        value={username}
        onChange={(u) => { setUsername(u); setPin(''); }}
        roles={['manager', 'admin']}
        disabled={verifying}
        placeholder="Select manager"
      />

      <Text style={ap.fieldLabel}>PIN</Text>
      <PinKeypad
        pin={pin}
        onChange={setPin}
        onComplete={handleVerify}
        disabled={verifying}
      />

      {!!authError && (
        <View style={ap.errorContainer}>
          <Text style={ap.error}>{authError}</Text>
        </View>
      )}
      {attempts > 0 && attemptsLeft > 0 && (
        <Text style={ap.attemptsLeft}>
          {attemptsLeft} attempt{attemptsLeft !== 1 ? 's' : ''} remaining
        </Text>
      )}

      <View style={ap.actions}>
        <TouchableOpacity style={ap.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={ap.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[ap.verifyBtn, (verifying || pin.length < 6) && ap.verifyBtnOff]}
          onPress={() => handleVerify()}
          disabled={verifying || pin.length < 6}
          activeOpacity={0.8}
        >
          {verifying
            ? <ActivityIndicator color={Colors.white} size="small" />
            : <Text style={ap.verifyText}>Approve Discount</Text>
          }
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ─── Add Cashier Panel (inline, left panel) ──────────────────────────────────

interface AddCashierPanelProps {
  onClose:   () => void;
  onSuccess: (user: AuthUser) => void;
  isOnline:  boolean;
}

function AddCashierPanel({ onClose, onSuccess, isOnline }: AddCashierPanelProps) {
  const [username,  setUsername]  = useState('');
  const [pin,       setPin]       = useState('');
  const [verifying, setVerifying] = useState(false);
  const [authError, setAuthError] = useState('');
  const [attempts,  setAttempts]  = useState(0);

  const attemptsLeft = MAX_AUTH_ATTEMPTS - attempts;

  async function handleAdd(completedPin?: string) {
    const pwd = completedPin ?? pin;
    setAuthError('');
    if (!username.trim() || pwd.length < 6) {
      setAuthError('Enter username and 6-digit PIN.');
      setPin('');
      return;
    }
    setVerifying(true);
    try {
      const newUser = await switchCashierAuth(username.trim(), pwd, isOnline);
      onSuccess(newUser);
    } catch (e: unknown) {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= MAX_AUTH_ATTEMPTS) {
        onClose();
        return;
      }
      setAuthError(`${(e as Error).message || 'Verification failed.'} (${next}/${MAX_AUTH_ATTEMPTS})`);
      setPin('');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <ScrollView
      style={ap.container}
      contentContainerStyle={ap.content}
      keyboardShouldPersistTaps="handled"
      bounces={false}
    >
      <View style={ap.titleRow}>
        <Text style={ap.title}>Add Cashier</Text>
        <TouchableOpacity onPress={onClose} hitSlop={12}>
          <Text style={ap.closeX}>✕</Text>
        </TouchableOpacity>
      </View>

      <Text style={ap.subtitle}>Sign in once to add this cashier to the session roster.</Text>

      <Text style={ap.fieldLabel}>Username</Text>
      <UsernameDropdown
        value={username}
        onChange={(u) => { setUsername(u); setPin(''); }}
        roles={['cashier']}
        disabled={verifying}
        placeholder="Select cashier"
      />

      <Text style={ap.fieldLabel}>PIN</Text>
      <PinKeypad
        pin={pin}
        onChange={setPin}
        onComplete={handleAdd}
        disabled={verifying}
      />

      {!!authError && (
        <View style={ap.errorContainer}>
          <Text style={ap.error}>{authError}</Text>
        </View>
      )}
      {attempts > 0 && attemptsLeft > 0 && (
        <Text style={ap.attemptsLeft}>
          {attemptsLeft} attempt{attemptsLeft !== 1 ? 's' : ''} remaining
        </Text>
      )}

      <View style={ap.actions}>
        <TouchableOpacity style={ap.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={ap.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[ap.verifyBtn, (verifying || pin.length < 6) && ap.verifyBtnOff]}
          onPress={() => handleAdd()}
          disabled={verifying || pin.length < 6}
          activeOpacity={0.8}
        >
          {verifying
            ? <ActivityIndicator color={Colors.white} size="small" />
            : <Text style={ap.verifyText}>Add to Session</Text>
          }
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ─── Product Card ─────────────────────────────────────────────────────────────

interface ProductCardProps {
  product: Product;
  onPress: (p: Product) => void;
  cols: number;
  containerWidth: number;
}

function GridIcon({ size, color }: { size: number; color: string }) {
  const d = Math.floor(size * 0.38);
  const g = Math.floor(size * 0.14);
  const box = { width: d, height: d, backgroundColor: color, borderRadius: 1.5 };
  const row = { flexDirection: 'row' as const, gap: g };
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center', gap: g }}>
      <View style={row}><View style={box} /><View style={box} /></View>
      <View style={row}><View style={box} /><View style={box} /></View>
    </View>
  );
}

function ProductCard({ product, onPress, cols, containerWidth }: ProductCardProps) {
  const isOut = product.stock_status === 'out';
  const isLow = product.stock_status === 'low';

  const imageRatio  = cols <= 2 ? 1.4 : cols <= 4 ? 1 : 0.8;
  const nameLines   = cols <= 2 ? 4 : cols <= 4 ? 3 : 2;
  const nameFontSz  = cols <= 2 ? FontSize.base : cols <= 4 ? FontSize.sm : FontSize.xs;
  const priceFontSz = cols <= 2 ? FontSize.md   : cols <= 4 ? FontSize.sm : FontSize.xs;
  const emojiSz     = cols <= 2 ? 36 : cols <= 4 ? 28 : cols <= 6 ? 20 : 16;
  const infoPad     = cols >= 5 ? Spacing.xs : Spacing.sm;

  const cardWidth = containerWidth > 0
    ? (containerWidth - Spacing.sm * 2) / cols - Spacing.xs * 2
    : undefined;

  return (
    <TouchableOpacity
      style={[pc.card, cardWidth != null && { width: cardWidth }, isOut && pc.cardOut]}
      onPress={() => onPress(product)}
      disabled={isOut}
      activeOpacity={0.75}
    >
      <View style={[pc.imageBox, { aspectRatio: imageRatio }]}>
        {product.image
          ? <Image source={{ uri: product.image }} style={pc.image} resizeMode="cover" />
          : <Text style={[pc.imagePlaceholder, { fontSize: emojiSz }]}>☕</Text>
        }
      </View>
      <View style={[pc.info, { padding: infoPad }]}>
        <Text
          style={[pc.name, isOut && pc.nameOut, { fontSize: nameFontSz }]}
          numberOfLines={nameLines}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {product.name}
        </Text>
        <Text style={[pc.price, { fontSize: priceFontSz }]}>₱{product.price.toFixed(2)}</Text>
        {cols <= 4 && isLow && <Text style={pc.low}>Low stock</Text>}
        {cols <= 4 && isOut && <Text style={pc.out}>Out of stock</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ─── POS Screen ───────────────────────────────────────────────────────────────

export default function POSScreen({ route, navigation }: Props) {
  const user    = useAuthStore((s) => s.user)!;
  // session is mutable — draft sessions get replaced with real ones after reconciliation
  const [currentSession, setCurrentSession] = useState(route.params.session);
  const [isDraft,        setIsDraft]        = useState(route.params.isDraft ?? false);
  const setUser = useAuthStore((s) => s.setUser);

  const cartItems    = useCartStore(useShallow((s) => Object.values(s.items)));
  const total        = useCartStore((s) => s.total);
  const addItem      = useCartStore((s) => s.addItem);
  const updateQty    = useCartStore((s) => s.updateQuantity);
  const updateNote   = useCartStore((s) => s.updateNote);
  const clearCart    = useCartStore((s) => s.clearCart);

  const { width: windowWidth } = useWindowDimensions();
  const [colOverride,     setColOverride]    = useState<number | null>(5);
  const [gridContainerWidth, setGridContainerWidth] = useState(0);
  const [colPickerOpen,   setColPickerOpen]  = useState(false);

  const gridCols = useMemo(() => {
    if (colOverride !== null) return colOverride;
    const rightApprox = Math.min(Math.floor(windowWidth / 3), isTablet ? 340 : 280);
    const leftApprox  = windowWidth - rightApprox;
    return Math.max(2, Math.min(8, Math.floor(leftApprox / CARD_TARGET_WIDTH)));
  }, [windowWidth, colOverride]);

  const [products,    setProducts]   = useState<Product[]>([]);
  const [categories,  setCategories] = useState<Category[]>([]);
  const [loading,     setLoading]    = useState(true);
  const [loadError,   setLoadError]  = useState(false);
  const [selCat,      setSelCat]     = useState<string | null>(null);
  const [search,          setSearch]         = useState('');
  const [searchExpanded,  setSearchExpanded] = useState(false);
  const [modProduct,  setModProduct] = useState<Product | null>(null);
  const [queueCount,    setQueueCount]    = useState(0);
  const [payLaterCount, setPayLaterCount] = useState(0);
  const [syncing,       setSyncing]       = useState(false);
  const [catalogStale,  setCatalogStale]  = useState(false);
  const { notifySynced, subscribe } = useSyncEvents();
  const { isOnline }                = useNetwork();
  const wasOnline                   = useRef<boolean | null>(null);

  // Admin/manager can discount without approval; cashier needs a manager nonce
  const canDiscountFreely = user.role === 'admin' || user.role === 'manager';

  // Discount state — nonce is set after manager approves (cashier only); cleared on cart clear
  const [discountNonce,  setDiscountNonce]  = useState<string | null>(null);
  const [discountType,   setDiscountType]   = useState<'percent' | 'amount'>('percent');
  const [discountInput,  setDiscountInput]  = useState('20');
  const [showDiscountModal,   setShowDiscountModal]   = useState(false);
  const [showAddCashierPanel, setShowAddCashierPanel] = useState(false);
  const [infoModal,    setInfoModal]    = useState<{ title: string; body: string } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title:       string;
    body:        string;
    confirmText: string;
    danger?:     boolean;
    onConfirm:   () => void;
  } | null>(null);

  // Roster state — mirrors the session's roster array, updated locally on every action
  const [roster, setRoster] = useState<RosterEntry[]>(() => {
    const r = route.params.session.roster ?? [];
    // Backward compat: if no roster (old session), synthesize opener entry
    if (r.length === 0) {
      return [{
        uid:          user.uid,
        username:     user.username,
        full_name:    user.full_name,
        role:         user.role,
        clock_in_at:  route.params.session.start_time,
        clock_out_at: null,
        status:       'active',
      }];
    }
    return r;
  });
  const activeUid = currentSession.active_cashier_uid ?? user.uid;

  const appState      = useRef(AppState.currentState);
  // Refs so the AppState handler (set up once on mount) always has current values
  const isOnlineRef   = useRef(isOnline);
  const isDraftRef    = useRef(isDraft);
  const doSyncRef     = useRef<() => void>(() => {});
  // Synchronous guard — prevents two rapid sync triggers from both passing the
  // React state `syncing` check before the re-render propagates.
  const syncingRef    = useRef(false);


  // Keep refs current every render
  useEffect(() => {
    isOnlineRef.current = isOnline;
    isDraftRef.current  = isDraft;
    doSyncRef.current   = isDraft ? reconcileAndSync : triggerSync;
  });

  // Auto-sync (+ reconcile draft) when connectivity is restored
  useEffect(() => {
    if (wasOnline.current === false && isOnline) {
      doSyncRef.current();
      // If catalog failed to load at startup (Firestore was not yet connected),
      // re-fetch now that we have network.
      if (products.length === 0) {
        loadData();
      }
    }
    wasOnline.current = isOnline;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, products.length]);

  // Refresh catalog after sync so stock_status reflects the authoritative server values
  useEffect(() => {
    return subscribe(() => { loadData(); refreshQueueCount(); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadData();
    refreshQueueCount();
    refreshPayLaterCount();

    // On foreground: refresh count and sync if online + has pending orders
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current !== 'active' && next === 'active') {
        refreshQueueCount();
        refreshPayLaterCount();
        if (isOnlineRef.current) {
          doSyncRef.current();
        }
      }
      appState.current = next;
    });

    // Refresh pay-later count whenever this screen comes back into focus
    // (e.g. returning from PayLaterScreen after settling an order)
    const focusSub = navigation.addListener('focus', () => {
      refreshPayLaterCount();
    });

    return () => { sub.remove(); focusSub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData() {
    setLoadError(false);
    setLoading(true);
    try {
      const [prods, cats] = await Promise.all([getProducts(), getCategories()]);
      console.log('[loadData] products:', prods.length, 'categories:', cats.length);
      setProducts(prods);
      setCategories(cats);
      setCatalogStale(false);
    } catch (err) {
      console.error('[loadData] ERROR:', err);
      setLoadError(true);
      // Check if stale cache was used (getProducts falls back silently; flag here)
      const age = await getCatalogAge();
      setCatalogStale(age !== null);
    } finally {
      setLoading(false);
    }
  }

  async function refreshQueueCount() {
    setQueueCount(await pendingCount());
  }

  async function refreshPayLaterCount() {
    try {
      const unpaid = await getUnpaidOrdersBySession(currentSession.id);
      setPayLaterCount(unpaid.length);
    } catch {
      // non-fatal — badge just won't show
    }
  }

  async function reconcileAndSync() {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      syncPendingClose().catch(() => {});
      const realSession = await reconcileDraftSession(currentSession, user);
      setCurrentSession(realSession);
      setIsDraft(false);
      const result = await syncPendingOrders(realSession, user);
      if (result.synced > 0) notifySynced();
      alertDeadLettered(result.deadLettered);
    } catch (err) {
      logError('POSScreen:reconcileAndSync', err, 'Draft session reconciliation failed');
    } finally {
      await refreshQueueCount();
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  async function triggerSync() {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      syncPendingClose().catch(() => {});
      const result = await syncPendingOrders(currentSession, user);
      if (result.synced > 0) notifySynced();
      alertDeadLettered(result.deadLettered);
    } finally {
      await refreshQueueCount();
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  function alertDeadLettered(count: number) {
    if (count <= 0) return;
    setInfoModal({
      title: 'Orders Could Not Be Synced',
      body:  `${count} order${count !== 1 ? 's' : ''} failed too many times and have been moved to Failed. Review them in Pending Orders.`,
    });
  }

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchCat = selCat === null ||
        (p.category_ids ? p.category_ids.includes(selCat) : p.category_id === selCat);
      const matchSearch = !search.trim() || p.name.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [products, selCat, search]);

  const handleProductPress = useCallback((product: Product) => {
    if (product.stock_status === 'out') return;
    const hasActiveModifiers = product.modifier_groups.some(
      (g) => g.modifiers.some((m) => m.is_active !== false),
    );
    if (product.modifier_groups.length > 0 && hasActiveModifiers) {
      setModProduct(product);
    } else {
      addItem(product.id, product.name, product.price, product.cost, [], '', product.tracking_mode, product.stock_item_id, product.recipe_lines, product.needs_kitchen);
    }
  }, [addItem]);

  function handleModifierAdd(mods: SelectedModifier[], qty: number) {
    if (!modProduct) return;
    for (let i = 0; i < qty; i++) {
      addItem(modProduct.id, modProduct.name, modProduct.price, modProduct.cost, mods, '', modProduct.tracking_mode, modProduct.stock_item_id, modProduct.recipe_lines, modProduct.needs_kitchen);
    }
    setModProduct(null);
  }

  function clearDiscount() {
    setDiscountNonce(null);
    setDiscountInput('20');
    setDiscountType('percent');
  }

  // ── Roster helpers ──────────────────────────────────────────────────────────

  function persistRoster(
    updatedRoster: RosterEntry[],
    newActiveUid:  string,
    newActiveName: string,
    newEvents:     CashierEvent[],
  ) {
    const updated: typeof currentSession = {
      ...currentSession,
      roster:              updatedRoster,
      active_cashier_uid:  newActiveUid,
      active_cashier_name: newActiveName,
      cashier_log:         [...(currentSession.cashier_log ?? []), ...newEvents],
    };
    setCurrentSession(updated);
    setRoster(updatedRoster);

    // If offline, queue roster changes for Firestore sync when reconnected.
    // Accumulate events across multiple offline operations so none are lost.
    if (!isOnline) {
      loadPendingCashierSync().then((existing) =>
        savePendingCashierSync({
          sessionId:  currentSession.id,
          roster:     updatedRoster,
          activeUid:  newActiveUid,
          activeName: newActiveName,
          newEvents:  [...(existing?.newEvents ?? []), ...newEvents],
        }),
      ).catch(() => {});
    }
  }

  function handleAddCashierSuccess(newUser: AuthUser) {
    const existing = roster.find((e) => e.uid === newUser.uid);

    if (existing?.status === 'active') {
      setShowAddCashierPanel(false);
      setInfoModal({
        title: 'Already on Shift',
        body:  `${newUser.full_name} is already the active cashier on this shift.`,
      });
      return;
    }

    const now = new Date().toISOString();

    if (existing?.status === 'clocked_out') {
      // Re-clock them in and make them active
      const logEvents: CashierEvent[] = [
        { uid: user.uid, username: user.username, full_name: user.full_name, role: user.role, action: 'switch_out', at: now },
        { uid: newUser.uid, username: newUser.username, full_name: newUser.full_name, role: newUser.role, action: 'clock_in', at: now },
      ];
      const updatedRoster = roster.map((e) =>
        e.uid === newUser.uid
          ? { ...e, clock_out_at: null, status: 'active' as const, clock_in_at: now }
          : e,
      );
      persistRoster(updatedRoster, newUser.uid, newUser.full_name, logEvents);
      setUser(newUser);
      clearDiscount();
      setShowAddCashierPanel(false);

      const prevUser = user;
      addCashierToRoster(currentSession.id, newUser, prevUser, roster).catch((err) =>
        logError('POSScreen:handleAddCashierSuccess', err, 'Failed to sync re-clock-in to Firestore'),
      );
      return;
    }

    const logEvents: CashierEvent[] = [
      { uid: user.uid, username: user.username, full_name: user.full_name, role: user.role, action: 'switch_out', at: now },
      { uid: newUser.uid, username: newUser.username, full_name: newUser.full_name, role: newUser.role, action: 'clock_in', at: now },
    ];
    const newEntry: RosterEntry = {
      uid: newUser.uid, username: newUser.username,
      full_name: newUser.full_name, role: newUser.role,
      clock_in_at: now, clock_out_at: null, status: 'active',
    };
    const updatedRoster = [...roster, newEntry];

    persistRoster(updatedRoster, newUser.uid, newUser.full_name, logEvents);
    setUser(newUser);
    clearDiscount();
    setShowAddCashierPanel(false);

    const prevUser = user;
    addCashierToRoster(currentSession.id, newUser, prevUser, roster).catch((err) =>
      logError('POSScreen:handleAddCashierSuccess', err, 'Failed to sync new cashier to Firestore'),
    );
  }

  function handleRosterSwitch(entry: RosterEntry) {
    const prevUser: AuthUser = {
      uid: user.uid, username: user.username,
      full_name: user.full_name, role: user.role,
    };
    const nextUser: AuthUser = {
      uid: entry.uid, username: entry.username,
      full_name: entry.full_name, role: entry.role,
    };
    if (prevUser.uid === nextUser.uid) return;

    const now = new Date().toISOString();
    const logEvents: CashierEvent[] = [
      { ...prevUser, action: 'switch_out', at: now },
      { ...nextUser, action: 'switch_in',  at: now },
    ];
    const updatedRoster = entry.status === 'clocked_out'
      ? roster.map((e) =>
          e.uid === entry.uid
            ? { ...e, clock_out_at: null, status: 'active' as const, clock_in_at: now }
            : e,
        )
      : roster;

    persistRoster(updatedRoster, nextUser.uid, nextUser.full_name, logEvents);
    setUser(nextUser);
    clearDiscount();

    // Best-effort Firestore write — skipped for draft sessions, fails silently offline
    switchActiveCashier(currentSession.id, prevUser, nextUser).catch((err) =>
      logError('POSScreen:handleRosterSwitch', err, 'Failed to sync switch to Firestore'),
    );
  }

  function handleRosterClockOut(entry: RosterEntry) {
    const isActive = entry.uid === activeUid;
    const now = new Date().toISOString();

    if (isActive) {
      const others = roster.filter((e) => e.uid !== entry.uid && e.status === 'active');
      if (others.length === 0) {
        setInfoModal({ title: 'Cannot Clock Out', body: 'Add another cashier before clocking out.' });
        return;
      }
      const next = others[0];
      const currentUser: AuthUser = { uid: user.uid, username: user.username, full_name: user.full_name, role: user.role };
      const nextUser: AuthUser    = { uid: next.uid, username: next.username, full_name: next.full_name, role: next.role };

      const logEvents: CashierEvent[] = [
        { ...currentUser, action: 'switch_out', at: now },
        { ...nextUser,    action: 'switch_in',  at: now },
        { uid: entry.uid, username: entry.username, full_name: entry.full_name, role: entry.role, action: 'clock_out', at: now },
      ];
      const updatedRoster = roster.map((e) =>
        e.uid === entry.uid
          ? { ...e, clock_out_at: now, status: 'clocked_out' as const }
          : e,
      );

      persistRoster(updatedRoster, nextUser.uid, nextUser.full_name, logEvents);
      setUser(nextUser);
      clearDiscount();

      // Best-effort Firestore writes — skipped for draft sessions, fail silently offline
      switchActiveCashier(currentSession.id, currentUser, nextUser).catch((err) =>
        logError('POSScreen:handleRosterClockOut', err, `switch uid=${entry.uid}`),
      );
      clockOutCashierEntry(currentSession.id, entry.uid, roster).catch((err) =>
        logError('POSScreen:handleRosterClockOut', err, `clockOut uid=${entry.uid}`),
      );
      return;
    }

    const logEvents: CashierEvent[] = [
      { uid: entry.uid, username: entry.username, full_name: entry.full_name, role: entry.role, action: 'clock_out', at: now },
    ];
    const updatedRoster = roster.map((e) =>
      e.uid === entry.uid
        ? { ...e, clock_out_at: now, status: 'clocked_out' as const }
        : e,
    );

    persistRoster(updatedRoster, activeUid, currentSession.active_cashier_name ?? user.full_name, logEvents);

    // Best-effort Firestore write — skipped for draft sessions, fails silently offline
    clockOutCashierEntry(currentSession.id, entry.uid, roster).catch((err) =>
      logError('POSScreen:handleRosterClockOut', err, `uid=${entry.uid}`),
    );
  }

  function handleRosterChipPress(entry: RosterEntry) {
    if (entry.uid === activeUid) {
      const activeCount = roster.filter((e) => e.status === 'active').length;
      if (activeCount <= 1) {
        setInfoModal({ title: 'Cannot Clock Out', body: 'Add another cashier before clocking out.' });
        return;
      }
      setConfirmModal({
        title: `Clock Out ${entry.full_name}?`,
        body: 'This will record your clock-out time. Another cashier must take over.',
        confirmText: 'Clock Out',
        danger: true,
        onConfirm: () => handleRosterClockOut(entry),
      });
    } else {
      handleRosterSwitch(entry);
    }
  }

  const rawDiscountNum   = parseFloat(discountInput) || 0;
  const computedDiscount = (canDiscountFreely || !!discountNonce)
    ? discountType === 'percent'
      ? Math.min((rawDiscountNum / 100) * total, total)
      : Math.min(rawDiscountNum, total)
    : 0;

  function handleCheckout() {
    if (cartItems.length === 0) return;
    const discountAmount = computedDiscount;
    navigation.navigate('Payment', {
      session:        currentSession,
      total:          Math.max(0, total - discountAmount),
      discountAmount: discountAmount > 0 ? discountAmount : undefined,
      discountNonce:  discountAmount > 0 && discountNonce ? discountNonce : undefined,
    });
    clearDiscount();
  }

  const totalQty = cartItems.reduce((s, i) => s + i.quantity, 0);

  return (
    <View style={s.root}>
      {/* ── Left Panel ── */}
      <View style={s.left}>
        {/* Top bar */}
        <View style={s.topBar}>
          {/* Session info */}
          <View style={s.topBarInfo}>
            {isDraft && <Text style={s.draftBadge}>DRAFT</Text>}
            <Text style={s.sessionInfo} numberOfLines={1}>
              {user.full_name} · {new Date(currentSession.start_time).toLocaleTimeString('en-PH', {
                hour: 'numeric', minute: '2-digit', hour12: true,
              })} · ₱{currentSession.starting_cash.toFixed(2)}
              {isDraft ? ' · offline' : ''}
            </Text>
          </View>

          {/* Roster chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.rosterScroll}
            contentContainerStyle={s.rosterScrollContent}
          >
            {roster.filter((e) => e.status !== 'clocked_out').map((entry) => {
              const isActive = entry.uid === activeUid;
              return (
                <TouchableOpacity
                  key={entry.uid}
                  style={[s.rosterChip, isActive && s.rosterChipActive]}
                  onPress={() => handleRosterChipPress(entry)}
                  activeOpacity={0.75}
                >
                  <View style={[s.rosterAvatar, isActive && s.rosterAvatarActive]}>
                    <Text style={[s.rosterAvatarText, isActive && s.rosterAvatarTextActive]}>
                      {rosterInitials(entry.full_name)}
                    </Text>
                  </View>
                  <Text style={[s.rosterChipName, isActive && s.rosterChipNameActive]} numberOfLines={1}>
                    {entry.full_name.split(' ')[0]}
                  </Text>
                  {isActive && <View style={s.rosterActiveDot} />}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={s.rosterAddChip}
              onPress={() => setShowAddCashierPanel(true)}
              activeOpacity={0.75}
            >
              <Text style={s.rosterAddChipText}>+ Add</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Action buttons */}
          <View style={s.topBarActions}>
            {queueCount > 0 && (
              <TouchableOpacity
                style={[s.syncBadge, syncing && s.syncBadgeSyncing]}
                onPress={() => navigation.navigate('PendingOrders', { session: currentSession })}
                disabled={syncing}
              >
                {syncing
                  ? <ActivityIndicator size="small" color={Colors.warning} />
                  : <Text style={s.syncBadgeText}>⚠ {queueCount}</Text>
                }
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={s.endShiftBtn}
              onPress={() => navigation.navigate('SessionOrders', { session: currentSession })}
              activeOpacity={0.7}
            >
              <Text style={s.endShiftText}>Orders</Text>
            </TouchableOpacity>
            {payLaterCount > 0 && (
              <TouchableOpacity
                style={[s.endShiftBtn, s.payLaterBtnActive]}
                onPress={() => navigation.navigate('PayLater', { session: currentSession })}
                activeOpacity={0.7}
              >
                <Text style={[s.endShiftText, s.payLaterBtnActiveText]}>
                  Pay Later ({payLaterCount})
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.endShiftBtn, isDraft && s.endShiftBtnDisabled]}
              onPress={() => {
                if (isDraft) {
                  setInfoModal({
                    title: 'Reconnect First',
                    body:  'Your session is offline. Reconnect to sync your orders before ending the shift.',
                  });
                  return;
                }
                navigation.navigate('CloseSession', { session: currentSession });
              }}
              activeOpacity={0.7}
            >
              <Text style={s.endShiftText}>End Shift</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showDiscountModal ? (
          <DiscountAuthPanel
            onClose={() => setShowDiscountModal(false)}
            onSuccess={(nonce, type, input) => {
              setDiscountNonce(nonce);
              setDiscountType(type);
              setDiscountInput(input);
              setShowDiscountModal(false);
            }}
            isOnline={isOnline}
            initialDiscountType={discountType}
            initialDiscountInput={discountInput}
            cartSubtotal={total}
          />
        ) : showAddCashierPanel ? (
          <AddCashierPanel
            onClose={() => setShowAddCashierPanel(false)}
            onSuccess={handleAddCashierSuccess}
            isOnline={isOnline}
          />
        ) : (
          <>
            {/* Offline banner */}
            {!isOnline && (
              <View style={s.offlineBanner}>
                <Text style={s.offlineBannerText}>
                  ⚠ Offline — orders are being saved locally and will sync when connection returns
                </Text>
              </View>
            )}

            {/* Stale catalog notice */}
            {catalogStale && isOnline && (
              <View style={s.staleBanner}>
                <Text style={s.staleBannerText}>Using cached product list</Text>
                <TouchableOpacity onPress={loadData} activeOpacity={0.7}>
                  <Text style={s.staleBannerRefresh}>Refresh</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Category tabs + search + column picker — merged row */}
            <View style={s.filterRow}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={s.catScrollInline}
                contentContainerStyle={s.catContentInline}
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

              <View style={s.filterDivider} />

              <View style={s.filterRight}>
                {/* Column preset picker */}
                {colPickerOpen ? (
                  <View style={s.colPickerInner}>
                    {([null, 2, 3, 4, 5] as Array<number | null>).map((n) => (
                      <TouchableOpacity
                        key={n ?? 'auto'}
                        style={[s.colPickerPill, colOverride === n && s.colPickerPillSel]}
                        onPress={() => { setColOverride(n); setColPickerOpen(false); }}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.colPickerPillText, colOverride === n && s.colPickerPillTextSel]}>
                          {n ?? 'A'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      style={s.searchIconBtn}
                      onPress={() => setColPickerOpen(false)}
                      activeOpacity={0.7}
                    >
                      <GridIcon size={18} color={Colors.green600} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={s.searchIconBtn}
                    onPress={() => { setColPickerOpen(true); setSearchExpanded(false); setSearch(''); }}
                    activeOpacity={0.7}
                  >
                    <GridIcon size={18} color={colOverride !== null ? Colors.green600 : Colors.gray500} />
                    {colOverride !== null && <View style={s.searchActiveDot} />}
                  </TouchableOpacity>
                )}

                {/* Search — hidden while col picker is open */}
                {!colPickerOpen && (
                  searchExpanded ? (
                    <View style={s.searchInner}>
                      <TextInput
                        style={s.searchInputCompact}
                        placeholder="Search…"
                        placeholderTextColor={Colors.gray400}
                        value={search}
                        onChangeText={setSearch}
                        returnKeyType="search"
                        autoFocus
                        onBlur={() => { if (!search) setSearchExpanded(false); }}
                      />
                      <TouchableOpacity
                        style={s.searchClear}
                        onPress={() => { setSearch(''); setSearchExpanded(false); }}
                      >
                        <Text style={s.searchClearText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={s.searchIconBtn}
                      onPress={() => setSearchExpanded(true)}
                      activeOpacity={0.7}
                    >
                      <Text style={s.searchIconText}>⌕</Text>
                      {!!search && <View style={s.searchActiveDot} />}
                    </TouchableOpacity>
                  )
                )}
              </View>
            </View>

            {/* Product grid */}
            {loading ? (
              <View style={s.loadingBox}>
                <ActivityIndicator size="large" color={Colors.green600} />
              </View>
            ) : loadError ? (
              <View style={s.loadingBox}>
                <View style={s.loadErrorBox}>
                  <Text style={s.loadErrorText}>Could not load products.</Text>
                </View>
                <TouchableOpacity style={s.retryBtn} onPress={loadData} activeOpacity={0.8}>
                  <Text style={s.retryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : !isOnline && products.length === 0 ? (
              <View style={s.loadingBox}>
                <View style={s.loadErrorBox}>
                  <Text style={s.loadErrorText}>No product data saved on this device.</Text>
                  <Text style={s.loadErrorSubtext}>
                    Connect to the internet to download your menu. Products will be
                    available offline after the first successful sync.
                  </Text>
                </View>
              </View>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={(p) => p.id}
                numColumns={gridCols}
                key={gridCols}
                contentContainerStyle={s.gridContent}
                onLayout={(e) => setGridContainerWidth(e.nativeEvent.layout.width)}
                renderItem={({ item }) => (
                  <ProductCard product={item} onPress={handleProductPress} cols={gridCols} containerWidth={gridContainerWidth} />
                )}
                ListEmptyComponent={
                  <View style={s.emptyBox}>
                    <Text style={s.emptyText}>No products found</Text>
                  </View>
                }
              />
            )}
          </>
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
              onPress={() => setConfirmModal({
                title:       'Clear Cart',
                body:        'Remove all items from the order?',
                confirmText: 'Clear',
                danger:      true,
                onConfirm:   () => { clearCart(); clearDiscount(); },
              })}
              hitSlop={8}
              activeOpacity={0.7}
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
              <View style={s.cartRowTop}>
                <View style={s.cartRowInfo}>
                  <Text style={s.cartRowName} numberOfLines={1}>{item.name}</Text>
                  {item.modifiers.length > 0 && (
                    <Text style={s.cartRowMods} numberOfLines={1}>
                      {item.modifiers.map((m) => m.modifier_name).join(', ')}
                    </Text>
                  )}
                  <Text style={s.cartRowPrice}>
                    ₱{(item.unit_price * item.quantity).toFixed(2)}
                  </Text>
                </View>
                <View style={s.qtyControl}>
                  <TouchableOpacity
                    style={s.qtyMini}
                    onPress={() => updateQty(item.cart_key, item.quantity - 1)}
                    hitSlop={8}
                    activeOpacity={0.7}
                  >
                    <Text style={s.qtyMiniText}>−</Text>
                  </TouchableOpacity>
                  <Text style={s.qtyNum}>{item.quantity}</Text>
                  <TouchableOpacity
                    style={s.qtyMini}
                    onPress={() => updateQty(item.cart_key, item.quantity + 1)}
                    hitSlop={8}
                    activeOpacity={0.7}
                  >
                    <Text style={s.qtyMiniText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <TextInput
                style={s.cartItemNotes}
                placeholder="Add note…"
                placeholderTextColor={Colors.gray400}
                value={item.notes ?? ''}
                onChangeText={(t) => updateNote(item.cart_key, t)}
                scrollEnabled={false}
              />
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
                {/* % / ₱ toggle */}
                <View style={s.discountTypeRow}>
                  <TouchableOpacity
                    style={[s.discountTypeBtn, discountType === 'percent' && s.discountTypeBtnSel]}
                    onPress={() => setDiscountType('percent')}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.discountTypeBtnText, discountType === 'percent' && s.discountTypeBtnTextSel]}>%</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.discountTypeBtn, discountType === 'amount' && s.discountTypeBtnSel]}
                    onPress={() => setDiscountType('amount')}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.discountTypeBtnText, discountType === 'amount' && s.discountTypeBtnTextSel]}>₱</Text>
                  </TouchableOpacity>
                </View>
                {/* Input row */}
                <View style={s.discountInputRow}>
                  <Text style={s.discountPrefix}>
                    {canDiscountFreely ? '🔓 ' : ''}−
                  </Text>
                  <TextInput
                    style={s.discountInput}
                    value={discountInput}
                    onChangeText={(t) => {
                      if (t === '' || /^\d*\.?\d*$/.test(t)) {
                        if (discountType === 'percent' && parseFloat(t) > 100) return;
                        setDiscountInput(t);
                      }
                    }}
                    placeholder="0"
                    placeholderTextColor={Colors.gray400}
                    keyboardType="decimal-pad"
                  />
                  <Text style={s.discountSuffix}>{discountType === 'percent' ? '%' : '₱'}</Text>
                  {!canDiscountFreely && (
                    <TouchableOpacity onPress={clearDiscount} hitSlop={8}>
                      <Text style={s.discountClear}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {rawDiscountNum > 0 && discountType === 'percent' && (
                  <Text style={s.discountLabel}>= −₱{computedDiscount.toFixed(2)} off</Text>
                )}
                {rawDiscountNum > 0 && discountType === 'amount' && (
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
          {(discountNonce || canDiscountFreely) && computedDiscount > 0 ? (
            <>
              <View style={s.totalRow}>
                <Text style={s.totalSubLabel}>Subtotal</Text>
                <Text style={s.totalSubAmount}>₱{total.toFixed(2)}</Text>
              </View>
              <View style={s.totalRow}>
                <Text style={s.discountRowLabel}>Discount</Text>
                <Text style={s.discountRowAmount}>
                  −₱{computedDiscount.toFixed(2)}
                </Text>
              </View>
              <View style={[s.totalRow, s.totalRowFinal]}>
                <Text style={s.totalLabel}>Total</Text>
                <Text style={s.totalAmount}>
                  ₱{Math.max(0, total - computedDiscount).toFixed(2)}
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

      {/* Generic Info Modal */}
      {infoModal && (
        <AppModal
          visible
          variant="info"
          title={infoModal.title}
          body={infoModal.body}
          onClose={() => setInfoModal(null)}
        />
      )}

      {/* Generic Confirm Modal */}
      {confirmModal && (
        <AppModal
          visible
          variant="confirm"
          title={confirmModal.title}
          body={confirmModal.body}
          confirmText={confirmModal.confirmText}
          danger={confirmModal.danger}
          onCancel={() => setConfirmModal(null)}
          onConfirm={() => { confirmModal.onConfirm(); setConfirmModal(null); }}
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
    backgroundColor: Colors.green700,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    gap: Spacing.sm,
  },
  topBarInfo: {
    flex: 1,
    minWidth: 0,
  },
  rosterScroll: {
    flexShrink: 1,
    flexGrow: 0,
    maxWidth: '35%',
  },
  rosterScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  rosterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  rosterChipActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderColor: 'rgba(255,255,255,0.6)',
  },
  rosterAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rosterAvatarActive: {
    backgroundColor: Colors.white,
  },
  rosterAvatarText: {
    fontSize: 8,
    fontWeight: FontWeight.bold,
    color: 'rgba(255,255,255,0.9)',
  },
  rosterAvatarTextActive: {
    color: Colors.green700,
  },
  rosterChipName: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.8)',
    maxWidth: 52,
  },
  rosterChipNameActive: {
    color: Colors.white,
    fontWeight: FontWeight.semibold,
  },
  rosterActiveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.green200,
  },
  rosterAddChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderStyle: 'dashed',
  },
  rosterAddChipText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: 'rgba(255,255,255,0.85)',
  },
  draftBadge: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.warning,
    backgroundColor: Colors.warningBg,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    overflow: 'hidden',
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
    flexShrink: 1,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexShrink: 0,
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.warningBg,
    borderWidth: 1,
    borderColor: Colors.warning + '66',
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
  endShiftBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  endShiftBtnDisabled: {
    opacity: 0.4,
  },
  payLaterBtnActive: {
    backgroundColor: Colors.warning,
    borderColor: Colors.warning,
  },
  payLaterBtnActiveText: {
    fontWeight: FontWeight.bold,
  },
  endShiftText: {
    fontSize: FontSize.sm,
    color: Colors.white,
    fontWeight: FontWeight.medium,
  },
  offlineBanner: {
    backgroundColor: Colors.warningBg,
    borderBottomWidth: 1,
    borderColor: Colors.warning + '44',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  offlineBannerText: {
    fontSize: FontSize.xs,
    color: Colors.warning,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  staleBanner: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.gray50,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.lg,
  },
  staleBannerText: {
    fontSize: FontSize.xs,
    color: Colors.gray500,
  },
  staleBannerRefresh: {
    fontSize: FontSize.xs,
    color: Colors.green700,
    fontWeight: FontWeight.bold,
  },
  catScroll: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    flexGrow: 0,
    flexShrink: 0,
  },
  catContent: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    flexShrink: 0,
  },
  catScrollInline: {
    flex: 1,
  },
  catContentInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  filterDivider: {
    width: 1,
    backgroundColor: Colors.border,
  },
  filterRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    flexShrink: 0,
  },
  searchInner: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 130,
  },
  searchInputCompact: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.gray800,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
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
    paddingHorizontal: Spacing.sm,
  },
  searchClearText: {
    fontSize: FontSize.sm,
    color: Colors.gray400,
  },

  searchIconBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchIconText: {
    fontSize: 20,
    color: Colors.gray500,
    lineHeight: 22,
  },
  searchActiveDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.green600,
  },

  colPickerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  colPickerPill: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colPickerPillSel: {
    backgroundColor: Colors.green600,
    borderColor: Colors.green600,
  },
  colPickerPillText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.gray600,
  },
  colPickerPillTextSel: {
    color: Colors.white,
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
  loadErrorBox: {
    backgroundColor: Colors.dangerBg,
    borderWidth: 1,
    borderColor: Colors.danger + '44',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  loadErrorText: {
    fontSize: FontSize.base,
    color: Colors.danger,
    fontWeight: FontWeight.medium,
  },
  loadErrorSubtext: {
    fontSize: FontSize.sm,
    color: Colors.gray600,
    marginTop: Spacing.xs,
    lineHeight: 18,
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
    flexDirection: 'column',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderColor: Colors.gray100,
    gap: Spacing.xs,
  },
  cartRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cartRowInfo: {
    flex: 1,
  },
  cartItemNotes: {
    fontSize: FontSize.xs,
    color: Colors.gray700,
    paddingVertical: 3,
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.gray200,
    borderRadius: Radius.sm,
    backgroundColor: Colors.gray50,
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
    gap: Spacing.xs,
  },
  discountTypeRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  discountTypeBtn: {
    flex: 1,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.danger + '44',
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  discountTypeBtnSel: {
    backgroundColor: Colors.danger + '18',
    borderColor: Colors.danger,
  },
  discountTypeBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.gray400,
  },
  discountTypeBtnTextSel: {
    color: Colors.danger,
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
  discountSuffix: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.danger,
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
    margin: Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  cardOut: {
    opacity: 0.5,
  },
  imageBox: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: Colors.green50,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
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
  kav: {
    // On Expo Web the KAV with flex:1 or absoluteFill only covers the visual
    // viewport (which excludes the browser toolbar height), leaving the app's
    // top bar uncovered. position:'fixed' anchors to the layout viewport so the
    // dark backdrop covers the full screen. On native, flex:1 is correct.
    ...(Platform.OS === 'web'
      ? ({ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 } as object)
      : { flex: 1 }),
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.gray300,
    alignSelf: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: isTablet ? '75%' : '90%',
    ...Shadow.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.green700,
  },
  productName: {
    fontSize: isTablet ? FontSize.xl : FontSize.lg,
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
    flexShrink: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.lg,
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
    borderWidth: 1,
    borderColor: 'transparent',
  },
  badgeErr: {
    backgroundColor: Colors.dangerBg,
    borderColor: Colors.danger,
  },
  badgeText: {
    fontSize: FontSize.xs,
    color: Colors.gray600,
    fontWeight: FontWeight.medium,
  },
  badgeTextErr: {
    color: Colors.danger,
    fontWeight: FontWeight.bold,
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
  footer: {
    borderTopWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  qtyBtn: {
    width: isTablet ? 40 : 34,
    height: isTablet ? 40 : 34,
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
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  addBtnText: {
    fontSize: isTablet ? FontSize.lg : FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
});

// ─── Auth Panel Styles ────────────────────────────────────────────────────────

const ap = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  content: {
    padding: Spacing.xxl,
    gap: Spacing.md,
    flexGrow: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.gray800,
  },
  closeX: {
    fontSize: FontSize.lg,
    color: Colors.gray500,
    fontWeight: FontWeight.bold,
    padding: Spacing.xs,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
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
  errorContainer: {
    backgroundColor: Colors.dangerBg,
    borderWidth: 1,
    borderColor: Colors.danger + '44',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  error: {
    fontSize: FontSize.sm,
    color: Colors.danger,
    fontWeight: FontWeight.medium,
  },
  attemptsLeft: {
    fontSize: FontSize.xs,
    color: Colors.gray500,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.lg,
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

  // Discount input controls
  discountTypeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  discountTypeBtn: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.gray50,
  },
  discountTypeBtnSel: {
    backgroundColor: Colors.green700,
    borderColor: Colors.green700,
  },
  discountTypeBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray600,
  },
  discountTypeBtnTextSel: {
    color: Colors.white,
  },
  discountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray50,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  discountInputPrefix: {
    fontSize: FontSize.lg,
    color: Colors.gray500,
    fontWeight: FontWeight.medium,
  },
  discountInputField: {
    flex: 1,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.gray800,
    paddingVertical: Spacing.md,
  },
  discountInputSuffix: {
    fontSize: FontSize.base,
    color: Colors.gray500,
    fontWeight: FontWeight.medium,
  },
  discountPreview: {
    fontSize: FontSize.sm,
    color: Colors.green700,
    fontWeight: FontWeight.medium,
  },
});
