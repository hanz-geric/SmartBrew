import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '../../constants/theme';

const PIN_LENGTH = 6;
const ROWS = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']] as const;
const KEY_H = 52;
const DOT = 20;

interface Props {
  pin: string;
  onChange: (pin: string) => void;
  onComplete?: (pin: string) => void;
  disabled?: boolean;
}

export default function PinKeypad({ pin, onChange, onComplete, disabled }: Props) {
  const [revealed, setRevealed] = useState(false);

  function press(digit: string) {
    if (disabled || pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete?.(next);
  }

  function del() {
    if (disabled || pin.length === 0) return;
    onChange(pin.slice(0, -1));
  }

  return (
    <View>
      <View style={s.dotsRow}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => {
          const filled = i < pin.length;
          return (
            <View key={i} style={[s.dot, filled && s.dotFilled]}>
              {revealed && filled && (
                <Text style={s.dotChar}>{pin[i]}</Text>
              )}
            </View>
          );
        })}
        <TouchableOpacity
          style={s.eyeBtn}
          onPress={() => setRevealed(v => !v)}
          hitSlop={8}
          activeOpacity={0.6}
        >
          <Text style={s.eyeText}>{revealed ? 'Hide' : 'Show'}</Text>
        </TouchableOpacity>
      </View>

      <View style={s.keypad}>
        {ROWS.map(row => (
          <View key={row[0]} style={s.keyRow}>
            {row.map(d => (
              <TouchableOpacity
                key={d}
                style={[s.key, disabled && s.keyOff]}
                onPress={() => press(d)}
                disabled={disabled}
                activeOpacity={0.7}
              >
                <Text style={s.keyText}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
        <View style={s.keyRow}>
          <View style={s.keyGhost} />
          <TouchableOpacity
            style={[s.key, disabled && s.keyOff]}
            onPress={() => press('0')}
            disabled={disabled}
            activeOpacity={0.7}
          >
            <Text style={s.keyText}>0</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.key, s.keyDel, disabled && s.keyOff]}
            onPress={del}
            disabled={disabled}
            activeOpacity={0.7}
          >
            <Text style={[s.keyText, s.keyDelText]}>⌫</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
    borderColor: Colors.gray300,
    backgroundColor: Colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotFilled: {
    backgroundColor: Colors.green600,
    borderColor: Colors.green600,
  },
  dotChar: {
    color: Colors.white,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    lineHeight: DOT,
  },
  eyeBtn: {
    marginLeft: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  eyeText: {
    fontSize: FontSize.xs,
    color: Colors.green600,
    fontWeight: FontWeight.semibold,
  },
  keypad: {
    gap: Spacing.sm,
  },
  keyRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  key: {
    flex: 1,
    height: KEY_H,
    backgroundColor: Colors.gray50,
    borderWidth: 1.5,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyGhost: {
    flex: 1,
    height: KEY_H,
  },
  keyOff: {
    opacity: 0.4,
  },
  keyDel: {
    backgroundColor: Colors.gray100,
  },
  keyText: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.semibold,
    color: Colors.gray800,
  },
  keyDelText: {
    color: Colors.danger,
  },
});
