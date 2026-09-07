import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import {
  ALL_SHIFT_KINDS,
  Difficulty,
  PhantomTarget,
  SHIFT_KIND_LABEL,
  Settings,
  ShiftKind,
  ThemePreference,
} from '../engine';
import { Colors, THEME_PACKS, radius, useStyles, useTheme } from '../theme';
import PrimaryButton from './PrimaryButton';
import Sheet from './Sheet';

interface Props {
  visible: boolean;
  settings: Settings;
  /** The daily challenge is on screen: its rules cannot be changed. */
  daily: boolean;
  onClose: () => void;
  onChange: (patch: Partial<Settings>) => void;
  onNewGame: (difficulty: Difficulty) => void;
  onHelp: () => void;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
const SHIFT_EVERY = [1, 2, 3, 5];
const PHANTOM_EVERY = [2, 3, 5, 8];
const PHANTOM_LOCK = [3, 5, 8, 12];
const PHANTOM_MAX = [1, 2, 3, 5];
const PHANTOM_FADE_MS = [2000, 4000, 8000];
const PHANTOM_TARGETS: PhantomTarget[] = ['entries', 'givens', 'both'];
const THEMES: ThemePreference[] = ['system', 'light', 'dark'];
const TARGET_LABEL: Record<PhantomTarget, string> = {
  entries: 'My entries',
  givens: 'Givens',
  both: 'Both',
};

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
  const styles = useStyles(makeStyles);
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
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
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

export default function SettingsSheet({ visible, settings, daily, onClose, onChange, onNewGame, onHelp }: Props) {
  const styles = useStyles(makeStyles);
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
      <PrimaryButton
        label="How to play"
        variant="secondary"
        onPress={() => {
          onClose();
          onHelp();
        }}
      />

      {daily ? (
        <View style={styles.dailyNote}>
          <Text style={styles.dailyNoteText}>
            The daily challenge uses fixed rules, so difficulty, shifts and the phantom
            challenge cannot be changed while it is on screen. Appearance and assistance still apply.
          </Text>
        </View>
      ) : null}

      <Text style={styles.section}>Difficulty for the next free game</Text>
      <Segmented
        options={DIFFICULTIES}
        value={difficulty}
        onChange={setDifficulty}
        label={(d) => d[0].toUpperCase() + d.slice(1)}
      />

      {daily ? null : (
        <>
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

      <Text style={styles.section}>Phantom challenge</Text>
      <Row
        label="Digits fade away"
        hint="Every so often a filled cell fades out and locks. Remember what was there and reason with the phantom until you can put it back."
        value={settings.phantomMode}
        onChange={(v) => onChange({ phantomMode: v })}
      />
      {settings.phantomMode ? (
        <>
          <Text style={styles.subsection}>Which cells can fade</Text>
          <Segmented
            options={PHANTOM_TARGETS}
            value={settings.phantomTarget}
            onChange={(t) => onChange({ phantomTarget: t })}
            label={(t) => TARGET_LABEL[t]}
          />
          <Text style={styles.subsection}>A cell fades every … moves</Text>
          <Segmented
            options={PHANTOM_EVERY}
            value={settings.phantomEvery}
            onChange={(n) => onChange({ phantomEvery: n })}
            label={(n) => `${n}`}
          />
          <Text style={styles.subsection}>Locked for … moves</Text>
          <Segmented
            options={PHANTOM_LOCK}
            value={settings.phantomLockMoves}
            onChange={(n) => onChange({ phantomLockMoves: n })}
            label={(n) => `${n}`}
          />
          <Text style={styles.subsection}>At most … phantoms at once</Text>
          <Segmented
            options={PHANTOM_MAX}
            value={settings.phantomMax}
            onChange={(n) => onChange({ phantomMax: n })}
            label={(n) => `${n}`}
          />
          <Text style={styles.subsection}>Fade speed</Text>
          <Segmented
            options={PHANTOM_FADE_MS}
            value={settings.phantomFadeMs}
            onChange={(n) => onChange({ phantomFadeMs: n })}
            label={(n) => (n === 2000 ? 'Fast' : n === 4000 ? 'Normal' : 'Slow')}
          />
          <View style={{ height: 8 }} />
          <Row
            label="Mark phantom cells"
            hint="Show a ghost and the moves left on locked cells. Turn off to track them purely from memory."
            value={settings.phantomMarkers}
            onChange={(v) => onChange({ phantomMarkers: v })}
          />
        </>
      ) : null}

        </>
      )}

      <Text style={styles.section}>Appearance</Text>
      <Segmented
        options={THEMES}
        value={settings.theme}
        onChange={(t) => onChange({ theme: t })}
        label={(t) => t[0].toUpperCase() + t.slice(1)}
      />
      <Text style={styles.subsection}>Colour pack</Text>
      <View style={styles.packs}>
        {THEME_PACKS.map((pack) => {
          const active = pack.id === settings.themePack;
          const swatch = settings.theme === 'dark' ? pack.dark : pack.light;
          return (
            <Pressable
              key={pack.id}
              onPress={() => onChange({ themePack: pack.id })}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.pack, active && styles.packActive]}
            >
              <View style={styles.swatchRow}>
                {[swatch.background, swatch.surface, swatch.primary, swatch.accent, swatch.phantom].map(
                  (c, i) => (
                    <View key={i} style={[styles.swatch, { backgroundColor: c }]} />
                  ),
                )}
              </View>
              <Text style={[styles.packName, active && styles.packNameActive]}>{pack.name}</Text>
              <Text style={styles.packDesc} numberOfLines={2}>
                {pack.description}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ height: 8 }} />
      <Row
        label="Reduce motion"
        hint="Cells jump straight to their new places, with no sliding, flashing or popping."
        value={settings.reduceMotion}
        onChange={(v) => onChange({ reduceMotion: v })}
      />

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

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  section: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 18,
    marginBottom: 8,
  },
  packs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -3,
  },
  pack: {
    width: '50%',
    padding: 3,
  },
  packActive: {},
  swatchRow: {
    flexDirection: 'row',
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    height: 28,
  },
  swatch: {
    flex: 1,
  },
  packName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    marginTop: 4,
  },
  packNameActive: {
    color: colors.primary,
  },
  packDesc: {
    fontSize: 11,
    color: colors.textMuted,
  },
  dailyNote: {
    marginTop: 12,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: 10,
  },
  dailyNoteText: {
    fontSize: 13,
    color: colors.text,
  },
  subsection: {
    fontSize: 13,
    color: colors.text,
    marginTop: 10,
    marginBottom: 6,
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
    color: colors.onPrimary,
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
