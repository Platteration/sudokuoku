/**
 * Named rule sets. A preset only touches the rules of the game, never the
 * player's appearance or assistance choices, so switching preset keeps the
 * app looking and helping the way they set it up.
 */
import { Settings } from './game';
import { ALL_SHIFT_KINDS, ShiftKind } from './transforms';

/** The settings a preset is allowed to change. */
export const RULE_KEYS = [
  'enabledShifts',
  'shiftEvery',
  'shiftsPerMove',
  'phantomMode',
  'phantomTarget',
  'phantomEvery',
  'phantomLockMoves',
  'phantomMax',
  'phantomMarkers',
] as const;

export type RuleKey = (typeof RULE_KEYS)[number];
export type Rules = Pick<Settings, RuleKey>;

export interface Preset {
  id: string;
  name: string;
  description: string;
  icon: string;
  rules: Rules;
}

const NO_RELABEL: ShiftKind[] = ALL_SHIFT_KINDS.filter((k) => k !== 'relabel');

const base: Rules = {
  enabledShifts: NO_RELABEL,
  shiftEvery: 1,
  shiftsPerMove: 1,
  phantomMode: false,
  phantomTarget: 'both',
  phantomEvery: 3,
  phantomLockMoves: 5,
  phantomMax: 3,
  phantomMarkers: true,
};

export const PRESETS: Preset[] = [
  {
    id: 'zen',
    name: 'Zen',
    description: 'Plain Sudoku. Nothing moves, nothing fades.',
    icon: '🍵',
    rules: { ...base, enabledShifts: [], shiftsPerMove: 1 },
  },
  {
    id: 'classic',
    name: 'Classic',
    description: 'One shift after every move. The house rules.',
    icon: '🎲',
    rules: { ...base },
  },
  {
    id: 'phantom',
    name: 'Phantom',
    description: 'Shifts, plus digits that fade away and lock.',
    icon: '👻',
    rules: { ...base, phantomMode: true },
  },
  {
    id: 'blindfold',
    name: 'Blindfold',
    description: 'Phantoms with no markers. Track them from memory.',
    icon: '🕶',
    rules: { ...base, phantomMode: true, phantomMarkers: false },
  },
  {
    id: 'chaos',
    name: 'Chaos',
    description: 'Two shifts a move, digits relabel, phantoms everywhere.',
    icon: '🌪',
    rules: {
      ...base,
      enabledShifts: ALL_SHIFT_KINDS,
      shiftsPerMove: 2,
      phantomMode: true,
      phantomEvery: 2,
      phantomLockMoves: 8,
      phantomMax: 4,
    },
  },
];

export function applyPreset(settings: Settings, preset: Preset): Settings {
  return { ...settings, ...preset.rules };
}

function sameRules(a: Rules, b: Rules): boolean {
  for (const key of RULE_KEYS) {
    if (key === 'enabledShifts') {
      const x = [...a.enabledShifts].sort();
      const y = [...b.enabledShifts].sort();
      if (x.length !== y.length || x.some((v, i) => v !== y[i])) return false;
    } else if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

/** The preset the settings currently match, or null for a custom set. */
export function matchingPreset(settings: Settings): Preset | null {
  return PRESETS.find((p) => sameRules(settings, p.rules)) ?? null;
}
