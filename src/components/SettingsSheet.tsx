import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import {
  ALL_SHIFT_KINDS,
  Difficulty,
  PRESETS,
  PhantomTarget,
  SHIFT_KIND_LABEL,
  Settings,
  ShiftKind,
  ShiftPreview,
  ThemePreference,
  matchingPreset,
} from '../engine';
import { Colors, THEME_PACKS, radius, shadow, useStyles, useTheme } from '../theme';
import PrimaryButton from './PrimaryButton';
import Sheet from './Sheet';
import Icon from './ui/Icon';
import Press from './ui/Press';
import Segmented from './ui/Segmented';

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
const SHIFTS_PER_MOVE = [1, 2, 3];
const PHANTOM_EVERY = [2, 3, 5, 8];
const PHANTOM_LOCK = [3, 5, 8, 12];
const PHANTOM_MAX = [1, 2, 3, 5];
const PHANTOM_FADE_MS = [2000, 4000, 8000];
const PHANTOM_TARGETS: PhantomTarget[] = ['entries', 'givens', 'both'];
const THEMES: ThemePreference[] = ['system', 'light', 'dark'];
const PREVIEWS: ShiftPreview[] = ['off', 'category', 'exact'];
const PREVIEW_LABEL: Record<ShiftPreview, string> = {
  off: 'Off',
  category: 'Category',
  exact: 'Exact',
};
const TARGET_LABEL: Record<PhantomTarget, string> = {
  entries: 'My entries',
  givens: 'Givens',
  both: 'Both',
};

function Row({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Press
      onPress={() => onChange(!value)}
      scaleTo={0.985}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      style={[styles.row, value && styles.rowOn]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.line }}
        thumbColor={colors.surface}
        pointerEvents="none"
      />
    </Press>
  );
}

export default function SettingsSheet({ visible, settings, daily, onClose, onChange, onNewGame, onHelp }: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [difficulty, setDifficulty] = useState<Difficulty>(settings.difficulty);
  const active_preset = matchingPreset(settings)?.id ?? null;

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
        size="md"
        icon="help"
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
      <Text style={styles.section}>Presets</Text>
      <Text style={styles.sectionHint}>
        A preset sets the rules only. Your appearance and assistance choices stay as they are.
      </Text>
      <View style={styles.presets}>
        {PRESETS.map((preset) => {
          const active = active_preset === preset.id;
          return (
            <Press
              key={preset.id}
              onPress={() => onChange(preset.rules)}
              scaleTo={0.985}
              accessibilityRole="button"
              accessibilityLabel={preset.name}
              accessibilityState={{ selected: active }}
              style={[styles.preset, active && styles.presetActive]}
            >
              <View style={styles.presetIcon}>
                <Icon
                  name={preset.icon}
                  size={20}
                  color={active ? colors.primary : colors.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.presetName, active && styles.presetNameActive]}>{preset.name}</Text>
                <Text style={styles.presetDesc}>{preset.description}</Text>
              </View>
              {active ? <Icon name="check" size={18} color={colors.primary} /> : null}
            </Press>
          );
        })}
      </View>

      <Text style={styles.section}>Shifts per move</Text>
      <Segmented
        options={SHIFTS_PER_MOVE}
        value={settings.shiftsPerMove}
        onChange={(n) => onChange({ shiftsPerMove: n })}
        label={(n) => (n === 1 ? 'One' : `${n} in a row`)}
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
            <Press
              key={pack.id}
              onPress={() => onChange({ themePack: pack.id })}
              scaleTo={0.97}
              accessibilityRole="button"
              accessibilityLabel={pack.name}
              accessibilityState={{ selected: active }}
              style={styles.pack}
            >
              <View style={[styles.swatchRow, active && styles.swatchRowActive]}>
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
            </Press>
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
      <Text style={styles.subsection}>Warn me what is coming</Text>
      <Segmented
        options={PREVIEWS}
        value={settings.shiftPreview}
        onChange={(v) => onChange({ shiftPreview: v })}
        label={(v) => PREVIEW_LABEL[v]}
      />
      <Text style={styles.sectionHint}>
        Category names the family of the coming shift, exact spells it out. Off keeps the surprise.
      </Text>
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
  presets: {
    marginTop: 2,
  },
  preset: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  presetActive: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primarySoft,
  },
  presetIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.cellPeer,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  presetName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  presetNameActive: {
    color: colors.primary,
  },
  presetDesc: {
    fontSize: 12,
    color: colors.textMuted,
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
    height: 32,
  },
  swatchRowActive: {
    borderWidth: 2,
    borderColor: colors.primary,
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
    paddingVertical: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rowOn: {
    borderColor: colors.primary,
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
