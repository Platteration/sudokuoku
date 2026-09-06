import { createRng, randomSeed } from './rng';
import {
  CELLS,
  Difficulty,
  Grid,
  findConflicts,
  generatePuzzle,
  isComplete,
} from './sudoku';
import {
  ALL_SHIFT_KINDS,
  Shift,
  ShiftKind,
  applyToGrid,
  applyToNotes,
  permute,
  randomShift,
} from './transforms';

export interface Settings {
  difficulty: Difficulty;
  /** Which shift kinds may fire. */
  enabledShifts: ShiftKind[];
  /** A shift fires after every N moves (1 = every move). */
  shiftEvery: number;
  /** Highlight digits that clash with a peer. */
  highlightConflicts: boolean;
  /** Highlight entries that differ from the solution. */
  showMistakes: boolean;
  /** Animate cells sliding to their new spots. */
  animateShifts: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  difficulty: 'medium',
  enabledShifts: ALL_SHIFT_KINDS.filter((k) => k !== 'relabel'),
  shiftEvery: 1,
  highlightConflicts: true,
  showMistakes: false,
  animateShifts: true,
};

export interface ShiftEvent extends Shift {
  /** Move number after which the shift fired. */
  afterMove: number;
}

interface Snapshot {
  solution: Grid;
  given: boolean[];
  values: Grid;
  notes: number[];
  tokens: number[];
  selected: number | null;
  moves: number;
  lastShift: ShiftEvent | null;
  shiftCount: number;
}

export interface GameState extends Snapshot {
  seed: number;
  settings: Settings;
  notesMode: boolean;
  status: 'playing' | 'won';
  history: Snapshot[];
  /** Incremented every time the board changes; drives animations. */
  version: number;
  hintsUsed: number;
}

export type Action =
  | { type: 'select'; pos: number | null }
  | { type: 'input'; digit: number }
  | { type: 'erase' }
  | { type: 'toggleNotesMode' }
  | { type: 'undo' }
  | { type: 'hint' }
  | { type: 'newGame'; settings?: Partial<Settings>; seed?: number }
  | { type: 'updateSettings'; settings: Partial<Settings> };

const MAX_HISTORY = 200;

export function newGame(settings: Settings, seed: number = randomSeed()): GameState {
  const rng = createRng(seed);
  const { clues, solution } = generatePuzzle(rng, settings.difficulty);
  return {
    seed,
    settings,
    solution,
    given: clues.map((v) => v !== 0),
    values: clues.slice(),
    notes: new Array<number>(CELLS).fill(0),
    tokens: Array.from({ length: CELLS }, (_, i) => i),
    selected: null,
    moves: 0,
    lastShift: null,
    shiftCount: 0,
    notesMode: false,
    status: 'playing',
    history: [],
    version: 0,
    hintsUsed: 0,
  };
}

function snapshot(s: GameState): Snapshot {
  return {
    solution: s.solution,
    given: s.given,
    values: s.values,
    notes: s.notes,
    tokens: s.tokens,
    selected: s.selected,
    moves: s.moves,
    lastShift: s.lastShift,
    shiftCount: s.shiftCount,
  };
}

/** Per-game RNG for shifts, advanced by move count so shifts are reproducible. */
function shiftRng(state: GameState) {
  return createRng((state.seed ^ (state.moves * 0x9e3779b1)) >>> 0);
}

/** Applies one shift to the whole board, keeping the selection on its cell. */
export function applyShift(state: GameState, shift: Shift): GameState {
  const event: ShiftEvent = { ...shift, afterMove: state.moves };
  return {
    ...state,
    solution: applyToGrid(state.solution, shift),
    given: permute(state.given, shift),
    values: applyToGrid(state.values, shift),
    notes: applyToNotes(state.notes, shift),
    tokens: permute(state.tokens, shift),
    selected: state.selected === null ? null : shift.dest[state.selected],
    lastShift: event,
    shiftCount: state.shiftCount + 1,
    version: state.version + 1,
  };
}

/**
 * Records a completed move: bumps the counter, checks for a win and,
 * if the game continues, maybe fires a shift.
 */
function afterMove(prev: GameState, next: GameState): GameState {
  const moves = prev.moves + 1;
  let s: GameState = {
    ...next,
    moves,
    history: [...prev.history.slice(-(MAX_HISTORY - 1)), snapshot(prev)],
    version: next.version + 1,
  };
  if (isComplete(s.values)) {
    return { ...s, status: 'won', selected: null };
  }
  const every = Math.max(1, s.settings.shiftEvery);
  if (moves % every === 0) {
    const shift = randomShift(shiftRng(s), s.settings.enabledShifts);
    if (shift) s = applyShift(s, shift);
  }
  return s;
}

export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'select':
      return { ...state, selected: action.pos };

    case 'toggleNotesMode':
      return { ...state, notesMode: !state.notesMode };

    case 'updateSettings':
      return { ...state, settings: { ...state.settings, ...action.settings } };

    case 'newGame':
      return newGame({ ...state.settings, ...action.settings }, action.seed);

    case 'undo': {
      const prev = state.history[state.history.length - 1];
      if (!prev) return state;
      return {
        ...state,
        ...prev,
        history: state.history.slice(0, -1),
        status: 'playing',
        version: state.version + 1,
      };
    }

    case 'input': {
      const p = state.selected;
      if (state.status !== 'playing' || p === null || state.given[p]) return state;
      const d = action.digit;
      if (d < 1 || d > 9) return state;
      if (state.notesMode) {
        if (state.values[p] !== 0) return state;
        const notes = state.notes.slice();
        notes[p] ^= 1 << d;
        return { ...state, notes, version: state.version + 1 };
      }
      if (state.values[p] === d) return state;
      const values = state.values.slice();
      values[p] = d;
      const notes = state.notes.slice();
      notes[p] = 0;
      return afterMove(state, { ...state, values, notes });
    }

    case 'erase': {
      const p = state.selected;
      if (state.status !== 'playing' || p === null || state.given[p]) return state;
      if (state.values[p] === 0 && state.notes[p] === 0) return state;
      const values = state.values.slice();
      const notes = state.notes.slice();
      const wasValue = values[p] !== 0;
      values[p] = 0;
      notes[p] = 0;
      if (!wasValue) return { ...state, notes, version: state.version + 1 };
      return afterMove(state, { ...state, values, notes });
    }

    case 'hint': {
      const p = state.selected;
      if (state.status !== 'playing' || p === null || state.given[p]) return state;
      if (state.values[p] === state.solution[p]) return state;
      const values = state.values.slice();
      values[p] = state.solution[p];
      const notes = state.notes.slice();
      notes[p] = 0;
      return afterMove(state, {
        ...state,
        values,
        notes,
        hintsUsed: state.hintsUsed + 1,
      });
    }
  }
}

/** Positions that are filled but differ from the solution. */
export function mistakes(state: GameState): Set<number> {
  const out = new Set<number>();
  for (let p = 0; p < CELLS; p++) {
    if (state.values[p] !== 0 && state.values[p] !== state.solution[p]) out.add(p);
  }
  return out;
}

export { findConflicts };

/** How many of each digit remain to be placed. */
export function remainingCounts(state: GameState): number[] {
  const counts = new Array<number>(10).fill(9);
  counts[0] = 0;
  for (const v of state.values) if (v !== 0) counts[v]--;
  return counts;
}

export type { Difficulty, ShiftKind };
