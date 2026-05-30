import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CashierStackParamList } from '../../navigation/CashierStack';
import { useAuthStore } from '../../store/authStore';
import { getPendingOrders, removePendingOrder } from '../../db/queries/queue';
import { getFailedOrders, removeFailedOrder, recoverFailedOrder } from '../../db/queries/failedOrders';
import { syncPendingOrders, syncSingleOrder } from '../../services/syncService';
import { useSyncEvents } from '../../context/SyncContext';
import { getLogs, LogEntry } from '../../utils/logger';
import { CartItem, CheckoutPayload, FailedOrder, PaymentMethod, PendingOrder } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type Props = NativeStackScreenProps<CashierStackParamList, 'PendingOrders'>;
type Tab   = 'pending' | 'failed';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeTotal(payload: CheckoutPayload): number {
  const subtotal = payload.cart_snapshot.reduce(
    (s, i) => s + i.unit_price * i.quantity, 0,
  );
  return Math.max(0, subtotal - (payload.discount_amount ?? 0));
}

function itemCount(payload: CheckoutPayload): number {
  return payload.cart_snapshot.reduce((s, i) => s + i.quantity, 0);
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins   = Math.floor(diffMs / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) !== 1 ? 's' : ''} ago`;
}

function syncStatusChip(retryCount: number): { label: string; bg: string; color: string } {
  if (retryCount === 0) return { label: 'Pending',  bg: Colors.gray100,   color: Colors.gray600 };
  if (retryCount < 5)   return { label: 'Retrying', bg: Colors.warningBg, color: Colors.warning };
  return                       { label: 'Failed',   bg: Colors.dangerBg,  color: Colors.danger  };
}

const PAY_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash', card: 'Card', qr: 'QR', gift_card: 'Gift Card',
};

const TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine In', takeaway: 'Takeaway', delivery: 'Delivery',
};

// ─── Shared order card ────────────────────────────────────────────────────────

interface OrderCardProps {
  payload:    CheckoutPayload;
  label:      string;
  timeIso:    string;
  expanded:   boolean;
  onToggle:   () => void;
  statusChip?: { label: string; bg: string; color: string };
  actions?:   React.ReactNode;
}

function OrderCard({ payload, label, timeIso, expanded, onToggle, statusChip, actions }: OrderCardProps) {
  const total = computeTotal(payload);
  const qty   = itemCount(payload);

  return (
    <TouchableOpacity style={s.card} onPress={onToggle} activeOpacity={0.85}>
      <View style={s.cardRow}>
        <View style={s.cardLeft}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardLabel}>{label}</Text>
            {statusChip && (
              <View style={[s.chip, { backgroundColor: statusChip.bg }]}>
                <Text style={[s.chipText, { color: statusChip.color }]}>{statusChip.label}</Text>
              </View>
            )}
          </View>
          <Text style={s.cardMeta}>
            {relativeTime(timeIso)}
            {' · '}{qty} item{qty !== 1 ? 's' : ''}
            {' · '}{TYPE_LABELS[payload.order_type] ?? payload.order_type}
            {payload.table_number ? ` · ${payload.table_number}` : ''}
          </Text>
        </View>
        <View style={s.cardRight}>
          <Text style={s.cardTotal}>₱{total.toFixed(2)}</Text>
          <View style={s.payChip}>
            <Text style={s.payChipText}>{PAY_LABELS[payload.payment_method]}</Text>
          </View>
        </View>
        <Text style={s.chevron}>{expanded ? '▲' : '▼'}</Text>
      </View>

      {expanded && (
        <View style={s.detail}>
          <View style={s.divider} />
          {payload.cart_snapshot.map((ci: CartItem, idx: number) => (
            <View key={idx} style={s.itemRow}>
              <View style={s.itemInfo}>
                <Text style={s.itemName}>{ci.name}</Text>
                {ci.modifiers.length > 0 && (
                  <Text style={s.itemMods}>{ci.modifiers.map((m) => m.modifier_name).join(', ')}</Text>
                )}
                {!!ci.notes && <Text style={s.itemNote}>"{ci.notes}"</Text>}
              </View>
              <Text style={s.itemQty}>×{ci.quantity}</Text>
              <Text style={s.itemPrice}>₱{(ci.unit_price * ci.quantity).toFixed(2)}</Text>
            </View>
          ))}

          {(payload.discount_amount ?? 0) > 0 && (
            <View style={[s.itemRow, s.discountRow]}>
              <Text style={s.discountLabel}>Discount</Text>
              <Text style={s.discountAmt}>−₱{payload.discount_amount!.toFixed(2)}</Text>
            </View>
          )}

          <View style={s.detailTotalRow}>
            <Text style={s.detailTotalLabel}>Total</Text>
            <Text style={s.detailTotal}>₱{total.toFixed(2)}</Text>
          </View>

          {payload.payment_method === 'cash' && payload.cash_received != null && (
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Cash received</Text>
              <Text style={s.metaValue}>₱{payload.cash_received.toFixed(2)}</Text>
            </View>
          )}
          {payload.payment_method !== 'cash' && payload.reference_number && (
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Ref #</Text>
              <Text style={s.metaValue}>{payload.reference_number}</Text>
            </View>
          )}

          {actions}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PendingOrdersScreen({ route, navigation }: Props) {
  const { session } = route.params;
  const user        = useAuthStore((s) => s.user)!;

  const [tab,      setTab]      = useState<Tab>('pending');
  const [pending,  setPending]  = useState<PendingOrder[]>([]);
  const [failed,   setFailed]   = useState<FailedOrder[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [syncing,  setSyncing]  = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastError, setLastError] = useState<LogEntry | null>(null);

  const { subscribe, notifySynced } = useSyncEvents();
  const loadRef = useRef(loadAll);
  useEffect(() => { loadRef.current = loadAll; });

  useEffect(() => {
    loadAll();
    return subscribe(() => loadRef.current());
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [p, f, logs] = await Promise.all([
        getPendingOrders(),
        getFailedOrders(),
        getLogs(),
      ]);
      setPending(p);
      setFailed(f);
      const syncLog = logs.find((l) =>
        l.tag.startsWith('syncService') || l.tag.startsWith('createOrder'),
      );
      setLastError(syncLog ?? null);
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncAll() {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await syncPendingOrders(session, user);
      if (result.synced > 0) notifySynced();
    } finally {
      await loadAll();
      setSyncing(false);
    }
  }

  async function handleRetry(local_id: string) {
    if (retrying) return;
    setRetrying(local_id);
    try {
      const result = await syncSingleOrder(local_id, session, user);
      if (result.success) notifySynced();
    } finally {
      await loadAll();
      setRetrying(null);
    }
  }

  function handleDiscardPending(local_id: string) {
    Alert.alert(
      'Discard Order',
      'Discard this offline order? It cannot be recovered.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard', style: 'destructive',
          onPress: async () => {
            await removePendingOrder(local_id);
            setPending((prev) => prev.filter((o) => o.local_id !== local_id));
            if (expanded === local_id) setExpanded(null);
          },
        },
      ],
    );
  }

  async function handleRecover(order: FailedOrder) {
    await recoverFailedOrder(order);
    await loadAll();
  }

  function handleDiscardFailed(local_id: string) {
    Alert.alert(
      'Remove Failed Order',
      'Remove this order from the failed list? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            await removeFailedOrder(local_id);
            setFailed((prev) => prev.filter((o) => o.local_id !== local_id));
            if (expanded === local_id) setExpanded(null);
          },
        },
      ],
    );
  }

  const renderPending = useCallback(({ item, index }: { item: PendingOrder; index: number }) => {
    const isOpen     = expanded === item.local_id;
    const chip       = syncStatusChip(item.retry_count);
    const isRetrying = retrying === item.local_id;

    return (
      <OrderCard
        payload={item.payload}
        label={`Offline #${index + 1}`}
        timeIso={item.created_at}
        expanded={isOpen}
        onToggle={() => setExpanded(isOpen ? null : item.local_id)}
        statusChip={chip}
        actions={
          <View style={s.actions}>
            <TouchableOpacity
              style={[s.retryBtn, (isRetrying || syncing) && s.btnDisabled]}
              onPress={() => handleRetry(item.local_id)}
              disabled={isRetrying || syncing}
              activeOpacity={0.7}
            >
              {isRetrying
                ? <ActivityIndicator size="small" color={Colors.green700} />
                : <Text style={s.retryBtnText}>Retry</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.discardBtn, (isRetrying || syncing) && s.btnDisabled]}
              onPress={() => handleDiscardPending(item.local_id)}
              disabled={isRetrying || syncing}
              activeOpacity={0.7}
            >
              <Text style={s.discardBtnText}>Discard</Text>
            </TouchableOpacity>
          </View>
        }
      />
    );
  }, [expanded, retrying, syncing]);

  const renderFailed = useCallback(({ item, index }: { item: FailedOrder; index: number }) => {
    const isOpen = expanded === item.local_id;
    return (
      <OrderCard
        payload={item.payload}
        label={`Failed #${index + 1}`}
        timeIso={item.created_at}
        expanded={isOpen}
        onToggle={() => setExpanded(isOpen ? null : item.local_id)}
        statusChip={{ label: 'Failed', bg: Colors.dangerBg, color: Colors.danger }}
        actions={
          <View style={s.actions}>
            <TouchableOpacity
              style={s.retryBtn}
              onPress={() => handleRecover(item)}
              activeOpacity={0.7}
            >
              <Text style={s.retryBtnText}>Recover</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.discardBtn}
              onPress={() => handleDiscardFailed(item.local_id)}
              activeOpacity={0.7}
            >
              <Text style={s.discardBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
        }
      />
    );
  }, [expanded]);

  const currentData  = tab === 'pending' ? pending : failed;
  const isEmpty      = !loading && currentData.length === 0;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Pending Orders</Text>
        {tab === 'pending' && (
          <TouchableOpacity
            style={[s.syncAllBtn, (syncing || loading) && s.btnDisabled]}
            onPress={handleSyncAll}
            disabled={syncing || loading}
            activeOpacity={0.8}
          >
            {syncing
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <Text style={s.syncAllText}>Sync All</Text>
            }
          </TouchableOpacity>
        )}
      </View>

      {/* Last sync error banner */}
      {lastError && (
        <View style={s.errorBanner}>
          <Text style={s.errorBannerTitle}>Last sync error — share this with your manager:</Text>
          <Text style={s.errorBannerText} selectable>
            [{lastError.tag}] {lastError.message}
          </Text>
          <Text style={s.errorBannerTime}>
            {new Date(lastError.timestamp).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </Text>
        </View>
      )}

      {/* Tab bar */}
      <View style={s.tabBar}>
        <TouchableOpacity
          style={[s.tabBtn, tab === 'pending' && s.tabBtnSel]}
          onPress={() => { setTab('pending'); setExpanded(null); }}
          activeOpacity={0.7}
        >
          <Text style={[s.tabText, tab === 'pending' && s.tabTextSel]}>
            Pending{pending.length > 0 ? ` (${pending.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabBtn, tab === 'failed' && s.tabBtnSel]}
          onPress={() => { setTab('failed'); setExpanded(null); }}
          activeOpacity={0.7}
        >
          <Text style={[s.tabText, tab === 'failed' && s.tabTextSel]}>
            Failed{failed.length > 0 ? ` (${failed.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.green600} />
        </View>
      ) : isEmpty ? (
        <View style={s.center}>
          <Text style={s.emptyIcon}>{tab === 'pending' ? '✓' : '☑'}</Text>
          <Text style={s.emptyTitle}>
            {tab === 'pending' ? 'All synced' : 'No failed orders'}
          </Text>
          <Text style={s.emptySubtitle}>
            {tab === 'pending'
              ? 'No pending orders. All orders are synced.'
              : 'No orders have permanently failed.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={currentData as any[]}
          keyExtractor={(o) => o.local_id}
          contentContainerStyle={s.listContent}
          renderItem={tab === 'pending' ? renderPending : renderFailed}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    backgroundColor: Colors.green700,
  },
  backBtn:  { paddingVertical: Spacing.xs, paddingRight: Spacing.xs },
  backText: { fontSize: FontSize.base, color: Colors.white, fontWeight: FontWeight.medium },
  title:    { flex: 1, fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.white },
  syncAllBtn: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    minWidth: 80, alignItems: 'center',
  },
  syncAllText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.white },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderColor: Colors.border,
  },
  tabBtn: {
    flex: 1, paddingVertical: Spacing.md, alignItems: 'center',
    borderBottomWidth: 2, borderColor: 'transparent',
  },
  tabBtnSel:  { borderColor: Colors.green600 },
  tabText:    { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.gray500 },
  tabTextSel: { color: Colors.green700, fontWeight: FontWeight.bold },

  center: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: Spacing.xxxl, gap: Spacing.sm,
  },
  emptyIcon:     { fontSize: 48, color: Colors.green600 },
  emptyTitle:    { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.gray700 },
  emptySubtitle: { fontSize: FontSize.base, color: Colors.gray400, textAlign: 'center' },

  listContent: { padding: Spacing.lg, gap: Spacing.sm },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden', ...Shadow.sm,
  },
  cardRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: Spacing.lg, gap: Spacing.sm,
  },
  cardLeft: { flex: 1 },
  cardTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap',
  },
  cardLabel: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.gray800 },
  chip: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  chipText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  cardMeta: { fontSize: FontSize.xs, color: Colors.gray500, marginTop: 3 },
  cardRight: { alignItems: 'flex-end', gap: Spacing.xs },
  cardTotal: { fontSize: FontSize.lg, fontWeight: FontWeight.extrabold, color: Colors.green700 },
  payChip: {
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
    borderRadius: Radius.full, backgroundColor: Colors.gray100,
  },
  payChipText: { fontSize: FontSize.xs, color: Colors.gray600, fontWeight: FontWeight.medium },
  chevron: { fontSize: FontSize.xs, color: Colors.gray400, marginLeft: Spacing.xs },

  detail: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  divider: { height: 1, backgroundColor: Colors.border, marginBottom: Spacing.sm },

  itemRow: {
    flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4, gap: Spacing.sm,
  },
  itemInfo:  { flex: 1 },
  itemName:  { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  itemMods:  { fontSize: FontSize.xs, color: Colors.gray500, marginTop: 1 },
  itemNote:  { fontSize: FontSize.xs, color: Colors.info, fontStyle: 'italic' },
  itemQty:   { fontSize: FontSize.sm, color: Colors.gray500, minWidth: 28, textAlign: 'center' },
  itemPrice: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold,
    color: Colors.gray800, minWidth: 64, textAlign: 'right',
  },

  discountRow: {
    borderTopWidth: 1, borderColor: Colors.border,
    marginTop: Spacing.xs, paddingTop: Spacing.xs, justifyContent: 'space-between',
  },
  discountLabel: { flex: 1, fontSize: FontSize.sm, color: Colors.danger, fontWeight: FontWeight.medium },
  discountAmt:   { fontSize: FontSize.sm, color: Colors.danger, fontWeight: FontWeight.bold },

  detailTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderColor: Colors.border,
    marginTop: Spacing.sm, paddingTop: Spacing.sm,
  },
  detailTotalLabel: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray600 },
  detailTotal:      { fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, color: Colors.gray900 },

  metaRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingTop: Spacing.xs },
  metaLabel: { fontSize: FontSize.sm, color: Colors.gray500 },
  metaValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },

  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  retryBtn: {
    flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.green600,
    alignItems: 'center', minHeight: 36, justifyContent: 'center',
  },
  retryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.green700 },
  discardBtn: {
    flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.danger,
    alignItems: 'center', minHeight: 36, justifyContent: 'center',
  },
  discardBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.danger },
  btnDisabled: { opacity: 0.45 },

  errorBanner: {
    backgroundColor: Colors.dangerBg,
    borderBottomWidth: 1, borderBottomColor: Colors.danger + '44',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, gap: 2,
  },
  errorBannerTitle: { fontSize: FontSize.xs, fontWeight: FontWeight.bold, color: Colors.danger },
  errorBannerText:  { fontSize: FontSize.xs, color: Colors.gray800, fontFamily: 'monospace' },
  errorBannerTime:  { fontSize: FontSize.xs, color: Colors.gray500 },

  failedNote: {
    flex: 1, backgroundColor: Colors.dangerBg,
    borderRadius: Radius.sm, padding: Spacing.sm,
    justifyContent: 'center',
  },
  failedNoteText: { fontSize: FontSize.xs, color: Colors.danger, fontWeight: FontWeight.medium },
});
