import React, { useState } from 'react';
import {
  Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { RosterEntry } from '../types';
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '../constants/theme';

interface Props {
  roster:        RosterEntry[];
  activeUid:     string;
  onAddPress:    () => void;
  onSwitchPress: (entry: RosterEntry) => void;
  onClockOut:    (entry: RosterEntry) => void;
  disabled?:     boolean;
}

type RosterModal =
  | { kind: 'cannot_clock_out' }
  | { kind: 'clock_out'; entry: RosterEntry }
  | null;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function CashierRosterBar({
  roster, activeUid, onAddPress, onSwitchPress, onClockOut, disabled,
}: Props) {
  const [modal, setModal] = useState<RosterModal>(null);

  function handleChipPress(entry: RosterEntry) {
    if (disabled) return;
    if (entry.uid === activeUid) {
      const activeCount = roster.filter((e) => e.status === 'active').length;
      if (activeCount <= 1) {
        setModal({ kind: 'cannot_clock_out' });
        return;
      }
      setModal({ kind: 'clock_out', entry });
    } else {
      onSwitchPress(entry);
    }
  }

  return (
    <View style={s.bar}>
      <Text style={s.label}>On Shift</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        style={s.scrollView}
      >
        {roster.filter((e) => e.status !== 'clocked_out').map((entry) => {
          const isActive = entry.uid === activeUid;
          return (
            <TouchableOpacity
              key={entry.uid}
              style={[s.chip, isActive && s.chipActive]}
              onPress={() => handleChipPress(entry)}
              activeOpacity={0.75}
              disabled={disabled}
            >
              <View style={[s.avatar, isActive && s.avatarActive]}>
                <Text style={[s.avatarText, isActive && s.avatarTextActive]}>
                  {initials(entry.full_name)}
                </Text>
              </View>
              <Text
                style={[s.chipName, isActive && s.chipNameActive]}
                numberOfLines={1}
              >
                {entry.full_name.split(' ')[0]}
              </Text>
              {isActive && <View style={s.activeDot} />}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={s.addChip}
          onPress={onAddPress}
          activeOpacity={0.75}
          disabled={disabled}
        >
          <Text style={s.addChipText}>+ Add</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Cannot clock out — info */}
      {modal?.kind === 'cannot_clock_out' && (
        <Modal transparent animationType="fade" onRequestClose={() => setModal(null)}>
          <View style={m.overlay}>
            <View style={m.sheet}>
              <Text style={m.title}>Cannot Clock Out</Text>
              <Text style={m.body}>
                You are the only active cashier. Add another cashier first, or end the shift.
              </Text>
              <TouchableOpacity style={m.okBtn} onPress={() => setModal(null)} activeOpacity={0.8}>
                <Text style={m.okText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Clock out confirm */}
      {modal?.kind === 'clock_out' && (
        <Modal transparent animationType="fade" onRequestClose={() => setModal(null)}>
          <View style={m.overlay}>
            <View style={m.sheet}>
              <Text style={m.title}>Clock Out {modal.entry.full_name}?</Text>
              <Text style={m.body}>
                This will record your clock-out time. Another cashier must take over.
              </Text>
              <View style={m.actions}>
                <TouchableOpacity style={m.cancelBtn} onPress={() => setModal(null)} activeOpacity={0.7}>
                  <Text style={m.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[m.confirmBtn, m.confirmDanger]}
                  onPress={() => { onClockOut(modal.entry); setModal(null); }}
                  activeOpacity={0.8}
                >
                  <Text style={m.confirmText}>Clock Out</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

    </View>
  );
}

// ─── Roster Bar Styles ────────────────────────────────────────────────────────

const s = StyleSheet.create({
  bar: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   Colors.surface,
    borderBottomWidth: 1,
    borderColor:       Colors.border,
    paddingLeft:       Spacing.lg,
    paddingVertical:   Spacing.xs,
    gap:               Spacing.sm,
    flexShrink:        0,
  },
  label: {
    fontSize:      FontSize.xs,
    fontWeight:    FontWeight.semibold,
    color:         Colors.gray400,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    flexShrink:    0,
  },
  scrollView: { flex: 1 },
  scroll: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             Spacing.xs,
    paddingRight:    Spacing.md,
    paddingVertical: Spacing.xs,
  },

  chip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical:   4,
    borderRadius:      Radius.full,
    backgroundColor:   Colors.gray100,
    borderWidth:       1,
    borderColor:       Colors.border,
  },
  chipActive: { backgroundColor: Colors.green50,  borderColor: Colors.green600 },

  avatar: {
    width:           24,
    height:          24,
    borderRadius:    12,
    backgroundColor: Colors.gray300,
    alignItems:      'center',
    justifyContent:  'center',
  },
  avatarActive: { backgroundColor: Colors.green600 },
  avatarText: {
    fontSize:   9,
    fontWeight: FontWeight.bold,
    color:      Colors.gray600,
  },
  avatarTextActive: { color: Colors.white },

  chipName: {
    fontSize:   FontSize.xs,
    fontWeight: FontWeight.medium,
    color:      Colors.gray700,
    maxWidth:   70,
  },
  chipNameActive: { color: Colors.green700, fontWeight: FontWeight.semibold },

  activeDot: {
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: Colors.green500 ?? Colors.green600,
  },

  addChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   5,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.green600,
    borderStyle:       'dashed',
  },
  addChipText: {
    fontSize:   FontSize.xs,
    fontWeight: FontWeight.semibold,
    color:      Colors.green700,
  },
});

// ─── Modal Styles ─────────────────────────────────────────────────────────────

const m = StyleSheet.create({
  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent:  'center',
    alignItems:      'center',
    padding:         Spacing.xxl,
  },
  sheet: {
    width:           '100%',
    maxWidth:        360,
    backgroundColor: Colors.surface,
    borderRadius:    Radius.xl,
    padding:         Spacing.xl,
    gap:             Spacing.md,
    ...Shadow.lg,
  },
  title: {
    fontSize:   FontSize.xl,
    fontWeight: FontWeight.bold,
    color:      Colors.gray900,
  },
  body: {
    fontSize:   FontSize.base,
    color:      Colors.gray600,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    gap:           Spacing.md,
    marginTop:     Spacing.xs,
  },
  cancelBtn: {
    flex:          1,
    paddingVertical: Spacing.md,
    borderRadius:  Radius.md,
    borderWidth:   1.5,
    borderColor:   Colors.border,
    alignItems:    'center',
  },
  cancelText: {
    fontSize:   FontSize.base,
    fontWeight: FontWeight.semibold,
    color:      Colors.gray600,
  },
  confirmBtn: {
    flex:            1,
    paddingVertical: Spacing.md,
    borderRadius:    Radius.md,
    backgroundColor: Colors.green600,
    alignItems:      'center',
  },
  confirmDanger: { backgroundColor: Colors.danger },
  confirmText: {
    fontSize:   FontSize.base,
    fontWeight: FontWeight.bold,
    color:      Colors.white,
  },
  okBtn: {
    paddingVertical: Spacing.md,
    borderRadius:    Radius.md,
    backgroundColor: Colors.green600,
    alignItems:      'center',
  },
  okText: {
    fontSize:   FontSize.base,
    fontWeight: FontWeight.bold,
    color:      Colors.white,
  },
});
