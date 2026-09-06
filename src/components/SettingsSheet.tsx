import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import {
  ALL_SHIFT_KINDS,
  Difficulty,
  SHIFT_KIND_LABEL,
  Settings,
  ShiftKind,
} from '../engine';
import { colors, radius } from '../theme';
import PrimaryButton from './PrimaryButton';
import Sheet from './Sheet';

interface Props {
  visible: boolean;
  settings: Settings;
  onClose: () => void;
  onChange: (patch: Partial<Settings>) => void;
  onNewGame: (difficulty: Difficulty) => void;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
const SHIFT_EVERY = [1, 2, 3, 5];

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  label: (v: T) => string;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = o === value;
        return (
          <Pressable
            key={String(o)}
            onPress={() => onChange(o)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label(o)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Row({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

export default function SettingsSheet({ visible, settings, onClose, onChange, onNewGame }: Props) {
  const [difficulty, setDifficulty] = useState<Difficulty>(settings.difficulty);

  const toggleKind = (kind: ShiftKind, on: boolean) => {
    const set = new Set(settings.enabledShifts);
    if (on) set.add(kind);
    else set.delete(kind);
    onChange({ enabledShifts: ALL_SHIFT_KINDS.filter((k) => set.has(k)) });
  };

  return (
    <Sheet
      visible={visible}
      title="Settings"
      onClose={onClose}
      footer={
        <PrimaryButton
          label={`New ${difficulty} game`}
          onPress={() => {
            onNewGame(difficulty);
            onClose();
          }}
        />
      }
    >
      <Text style={styles.section}>Difficulty for the next game</Text>
      <Segmented
        options={DIFFICULTIES}
        value={difficulty}
        onChange={setDifficulty}
        label={(d) => d[0].toUpperCase() + d.slice(1)}
      />

      <Text style={styles.section}>Shift after every … moves</Text>
      <Segmented
        options={SHIFT_EVERY}
        value={settings.shiftEvery}
        onChange={(n) => onChange({ shiftEvery: n })}
        label={(n) => (n === 1 ? 'Every move' : `${n} moves`)}
      />

      <Text style={styles.section}>Which shifts can happen</Text>
      <Text style={styles.sectionHint}>
        One of the enabled shifts is chosen at random each time. Every shift keeps the puzzle
        solvable and keeps your entries correct.
      </Text>
      {ALL_SHIFT_KINDS.map((kind) => (
        <Row
          key={kind}
          label={SHIFT_KIND_LABEL[kind]}
          hint={kind === 'relabel' ? 'Changes the digits themselves, not their positions. Brutal.' : undefined}
          value={settings.enabledShifts.includes(kind)}
          onChange={(on) => toggleKind(kind, on)}
        />
      ))}

      <Text style={styles.section}>Assistance</Text>
      <Row
        label="Highlight conflicts"
        hint="Mark digits that clash in a row, column or box."
        value={settings.highlightConflicts}
        onChange={(v) => onChange({ highlightConflicts: v })}
      />
      <Row
        label="Show mistakes"
        hint="Mark entries that differ from the solution."
        value={settings.showMistakes}
        onChange={(v) => onChange({ showMistakes: v })}
      />
      <Row
        label="Animate shifts"
        value={settings.animateShifts}
        onChange={(v) => onChange({ animateShifts: v })}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  section: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 18,
    marginBottom: 8,
  },
  sectionHint: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 6,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  segmentLabel: {
    color: colors.text,
    fontSize: 14,
  },
  segmentLabelActive: {
    color: '#fff',
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rowLabel: {
    fontSize: 15,
    color: colors.text,
  },
  rowHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
