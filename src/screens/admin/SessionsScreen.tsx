import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, ScrollView, TextInput,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AdminLayout from './AdminLayout';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { getRecentSessions, getSessionsInRange } from '../../firebase/firestoreService';
import { useSyncEvents } from '../../context/SyncContext';
import { CashSession } from '../../types';
import { exportCsv } from '../../utils/csvExport';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type Nav = NativeStackNavigationProp<AdminStackParamList>;

// ─── Period helpers ───────────────────────────────────────────────────────────

type SessionPeriod = 'today' | 'week' | 'month' | 'all';

const SESSION_PERIODS: { value: SessionPeriod; label: string }[] = [
  { value: 'today', label: 'Today'      },
  { value: 'week',  label: 'This Week'  },
  { value: 'month', label: 'This Month' },
  { value: 'all',   label: 'All'        },
];

function getSessionRange(period: SessionPeriod): { start: string; end: string } | null {
  if (period === 'all') return null;
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'today':
      return {
        start: today.toISOString(),
        end:   new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString(),
      };
    case 'week': {
      const start = new Date(today); start.setDate(start.getDate() - 6);
      return { start: start.toISOString(), end: now.toISOString() };
    }
    case 'month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: start.toISOString(), end: now.toISOString() };
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PH', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function duration(start: string, end: string | null): string {
  if (!end) return 'Open';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const h  = Math.floor(ms / 3_600_000);
  const m  = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function buildSessionsCsv(sessions: CashSession[]): Parameters<typeof exportCsv> {
  const headers = ['Cashier', 'Opened', 'Closed', 'Starting Cash', 'Cash Collected', 'Expected', 'Actual', 'Difference', 'Status'];
  const rows = sessions.map((s) => [
    s.cashier_name,
    fmtDate(s.start_time),
    fmtDate(s.end_time),
    s.starting_cash.toFixed(2),
    (s.cash_collected ?? 0).toFixed(2),
    (s.expected_cash ?? '').toString(),
    (s.actual_cash ?? '').toString(),
    (s.difference ?? '').toString(),
    s.status === 'open' ? 'Open' : 'Closed',
  ]);
  const date = new Date().toISOString().slice(0, 10);
  return [`sessions_${date}.csv`, headers, rows];
}

// ─── Sessions Screen ──────────────────────────────────────────────────────────

export default function SessionsScreen() {
  const navigation = useNavigation<Nav>();

  const [sessions,     setSessions]     = useState<CashSession[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [period,         setPeriod]         = useState<SessionPeriod>('week');
  const [statusFilter,   setStatusFilter]   = useState<'all' | 'open' | 'closed'>('all');
  const [cashierSearch,  setCashierSearch]  = useState('');
  const [exporting,      setExporting]      = useState(false);
  const [syncVersion,    setSyncVersion]    = useState(0);

  const { subscribe } = useSyncEvents();
  useEffect(() => { return subscribe(() => setSyncVersion((v) => v + 1)); }, []);

  useEffect(() => { load(); }, [period, syncVersion]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const range = getSessionRange(period);
      setSessions(range
        ? await getSessionsInRange(range.start, range.end)
        : await getRecentSessions(100),
      );
    } catch {
      setError('Failed to load sessions.');
    } finally {
      setLoading(false);
    }
  }

  const filteredSessions = sessions.filter((sess) => {
    if (statusFilter !== 'all' && sess.status !== statusFilter) return false;
    if (cashierSearch.trim()) {
      return sess.cashier_name.toLowerCase().includes(cashierSearch.trim().toLowerCase());
    }
    return true;
  });

  const openCount    = filteredSessions.filter((s) => s.status === 'open').length;
  const closedCount  = filteredSessions.filter((s) => s.status === 'closed').length;
  const totalHandled = filteredSessions.reduce((s, sess) => s + (sess.cash_collected ?? 0), 0);
  const variance     = filteredSessions
    .filter((sess) => sess.difference !== null)
    .reduce((s, sess) => s + (sess.difference ?? 0), 0);

  async function handleExport() {
    if (!filteredSessions.length) return;
    setExporting(true);
    try {
      await exportCsv(...buildSessionsCsv(filteredSessions));
    } catch {
      // silently ignore share cancellation
    } finally {
      setExporting(false);
    }
  }

  return (
    <AdminLayout active="Sessions">
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.titleRow}>
            <Text style={s.title}>Cash Sessions</Text>
            <View style={s.titleActions}>
              {!loading && filteredSessions.length > 0 && (
                <TouchableOpacity
                  style={[s.exportBtn, exporting && s.exportBtnOff]}
                  onPress={handleExport}
                  disabled={exporting}
                  activeOpacity={0.8}
                >
                  <Text style={s.exportBtnText}>{exporting ? 'Exporting…' : '⬇ Export'}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.refreshBtn} onPress={load} disabled={loading}>
                <Text style={s.refreshText}>{loading ? '…' : '↻ Refresh'}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.periodTabsContent}
          >
            {SESSION_PERIODS.map((p) => (
              <TouchableOpacity
                key={p.value}
                style={[s.periodTab, period === p.value && s.periodTabSel]}
                onPress={() => { setPeriod(p.value); setStatusFilter('all'); }}
              >
                <Text style={[s.periodTabText, period === p.value && s.periodTabTextSel]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Cashier search */}
        <View style={s.searchRow}>
          <TextInput
            style={s.searchInput}
            placeholder="Search by cashier name…"
            placeholderTextColor={Colors.gray400}
            value={cashierSearch}
            onChangeText={setCashierSearch}
            returnKeyType="search"
          />
          {!!cashierSearch && (
            <TouchableOpacity onPress={() => setCashierSearch('')} style={s.searchClear} hitSlop={8}>
              <Text style={s.searchClearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Status filter chips */}
        <View style={s.statusFilterRow}>
          {(['all', 'open', 'closed'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[s.statusChip, statusFilter === f && s.statusChipSel]}
              onPress={() => setStatusFilter(f)}
              activeOpacity={0.7}
            >
              <Text style={[s.statusChipText, statusFilter === f && s.statusChipTextSel]}>
                {f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Closed'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Summary */}
        {!loading && !error && filteredSessions.length > 0 && (
          <View style={s.summaryBar}>
            <View style={s.summaryLeft}>
              <Text style={s.summaryText}>
                {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}
                {openCount > 0 ? ` · ${openCount} open` : ''}
                {closedCount > 0 ? ` · ${closedCount} closed` : ''}
              </Text>
            </View>
            <View style={s.summaryRight}>
              <Text style={s.summaryRevenue}>
                ₱{totalHandled.toLocaleString('en-PH', { minimumFractionDigits: 2 })} collected
              </Text>
              {variance !== 0 && (
                <Text style={[s.summaryVariance, variance > 0 ? s.varianceOver : s.varianceShort]}>
                  {variance > 0 ? '▲' : '▼'} ₱{Math.abs(variance).toFixed(2)}
                </Text>
              )}
            </View>
          </View>
        )}

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.green600} />
          </View>
        ) : error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : (
          <FlatList
            data={filteredSessions}
            keyExtractor={(s) => s.id}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={<Text style={s.emptyText}>No sessions found.</Text>}
            renderItem={({ item: sess }) => {
              const diff    = sess.difference;
              const isOpen  = sess.status === 'open';
              const isOver  = diff !== null && diff > 0;
              const isShort = diff !== null && diff < 0;
              const isExact = diff !== null && diff === 0;

              return (
                <TouchableOpacity
                  style={[s.card, isOpen && s.cardOpen]}
                  onPress={() => navigation.navigate('SessionDetail', { session: sess })}
                  activeOpacity={0.85}
                >
                  {/* Top row */}
                  <View style={s.cardTop}>
                    <View style={s.cardLeft}>
                      <Text style={s.cashier}>{sess.cashier_name}</Text>
                      <Text style={s.dateText}>
                        {fmtDateTime(sess.start_time)}
                        {sess.end_time
                          ? ` → ${fmtTime(sess.end_time)}  (${duration(sess.start_time, sess.end_time)})`
                          : ''}
                      </Text>
                    </View>
                    <View style={s.cardTopRight}>
                      <View style={[s.statusBadge, isOpen && s.statusOpen]}>
                        <Text style={[s.statusText, isOpen && s.statusOpenText]}>
                          {isOpen ? 'Open' : 'Closed'}
                        </Text>
                      </View>
                      <Text style={s.viewHint}>View ›</Text>
                    </View>
                  </View>

                  {/* Cash grid */}
                  <View style={s.cashGrid}>
                    <CashCell label="Starting"  value={`₱${sess.starting_cash.toFixed(2)}`} />
                    <CashCell label="Collected"  value={`₱${(sess.cash_collected ?? 0).toFixed(2)}`} />
                    <CashCell
                      label="Expected"
                      value={sess.expected_cash !== null ? `₱${sess.expected_cash.toFixed(2)}` : '—'}
                    />
                    <CashCell
                      label="Actual"
                      value={sess.actual_cash !== null ? `₱${sess.actual_cash.toFixed(2)}` : '—'}
                    />
                  </View>

                  {/* Difference */}
                  {diff !== null && (
                    <View style={[
                      s.diffRow,
                      isOver  && s.diffOver,
                      isShort && s.diffShort,
                      isExact && s.diffExact,
                    ]}>
                      <Text style={s.diffLabel}>
                        {isOver ? 'Over' : isShort ? 'Short' : 'Exact'}
                      </Text>
                      <Text style={s.diffValue}>
                        {isExact ? '₱0.00' : `${diff > 0 ? '+' : ''}₱${diff.toFixed(2)}`}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>

    </AdminLayout>
  );
}

function CashCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={cc.cell}>
      <Text style={cc.label}>{label}</Text>
      <Text style={cc.value}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  title: { fontSize: FontSize.display, fontWeight: FontWeight.bold, color: Colors.gray900 },
  exportBtn: {
    borderWidth: 1.5, borderColor: Colors.green600,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  exportBtnOff: { opacity: 0.5 },
  exportBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.green700 },
  periodTabsContent: { flexDirection: 'row', gap: Spacing.xs },
  periodTab: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.gray100,
  },
  periodTabSel:     { backgroundColor: Colors.green600 },
  periodTabText:    { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.gray600 },
  periodTabTextSel: { color: Colors.white, fontWeight: FontWeight.bold },
  refreshBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: Radius.md, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  refreshText: { fontSize: FontSize.sm, color: Colors.green700, fontWeight: FontWeight.semibold },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: Spacing.xl, marginTop: Spacing.sm, marginBottom: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  searchInput: {
    flex: 1, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    fontSize: FontSize.base, color: Colors.gray800, textAlignVertical: 'center',
  },
  searchClear: { paddingHorizontal: Spacing.md },
  searchClearText: { fontSize: FontSize.sm, color: Colors.gray400 },

  statusFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  statusChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: Radius.full, backgroundColor: Colors.gray100,
    borderWidth: 1, borderColor: 'transparent',
  },
  statusChipSel:     { backgroundColor: Colors.green50, borderColor: Colors.green600 },
  statusChipText:    { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.gray600 },
  statusChipTextSel: { color: Colors.green700, fontWeight: FontWeight.bold },

  summaryBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm,
    backgroundColor: Colors.green50, borderBottomWidth: 1, borderColor: Colors.green100,
    flexWrap: 'wrap', gap: Spacing.xs,
  },
  summaryLeft:     { flex: 1 },
  summaryRight:    { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  summaryText:     { fontSize: FontSize.sm, color: Colors.green700, fontWeight: FontWeight.medium },
  summaryRevenue:  { fontSize: FontSize.sm, color: Colors.green700, fontWeight: FontWeight.bold },
  summaryVariance: { fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  varianceOver:    { color: Colors.info },
  varianceShort:   { color: Colors.danger },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorBox: {
    margin: Spacing.xl,
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.danger + '44',
    padding: Spacing.lg,
  },
  errorText: { color: Colors.danger, fontSize: FontSize.base },
  emptyText: { textAlign: 'center', color: Colors.gray400, fontSize: FontSize.base, paddingVertical: Spacing.xxxl },
  listContent: { padding: Spacing.lg, gap: Spacing.md },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', ...Shadow.sm,
  },
  cardOpen:    { borderColor: Colors.green400 },
  cardTop:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: Spacing.lg },
  cardLeft:    { flex: 1 },
  cardTopRight: { alignItems: 'flex-end', gap: Spacing.xs },
  cashier:  { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.gray900 },
  dateText: { fontSize: FontSize.sm, color: Colors.gray500, marginTop: 2 },
  viewHint: { fontSize: FontSize.xs, color: Colors.green600, fontWeight: FontWeight.medium },
  statusBadge: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: Radius.full, backgroundColor: Colors.gray100,
  },
  statusOpen:     { backgroundColor: Colors.green100 },
  statusText:     { fontSize: FontSize.xs, fontWeight: FontWeight.bold, color: Colors.gray600 },
  statusOpenText: { color: Colors.green700 },

  cashGrid: { flexDirection: 'row', borderTopWidth: 1, borderColor: Colors.border },
  diffRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderTopWidth: 1, borderColor: Colors.border,
  },
  diffOver:  { backgroundColor: Colors.infoBg },
  diffShort: { backgroundColor: Colors.dangerBg },
  diffExact: { backgroundColor: Colors.green50 },
  diffLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  diffValue: { fontSize: FontSize.base, fontWeight: FontWeight.extrabold, color: Colors.gray900 },
});

const cc = StyleSheet.create({
  cell: {
    flex: 1, padding: Spacing.md, alignItems: 'center',
    borderRightWidth: 1, borderColor: Colors.border,
  },
  label: { fontSize: FontSize.xs, color: Colors.gray500, fontWeight: FontWeight.medium, marginBottom: 2 },
  value: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.gray800 },
});

