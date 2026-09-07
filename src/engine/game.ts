import { createRng, pick, randomSeed } from './rng';
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

export type PhantomTarget = 'entries' | 'givens' | 'both';
export type ThemePreference = 'system' | 'light' | 'dark';
export type ShiftPreview = 'off' | 'category' | 'exact';

export interface Settings {
  difficulty: Difficulty;
  /** Which shift kinds may fire. */
  enabledShifts: ShiftKind[];
  /** A shift fires after every N moves (1 = every move). */
  shiftEvery: number;
  /** How many shifts fire back to back when one is triggered. */
  shiftsPerMove: number;
  /** How much of the coming shift to reveal before the player moves. */
  shiftPreview: ShiftPreview;
  /** Highlight digits that clash with a peer. */
  highlightConflicts: boolean;
  /** Highlight entries that differ from the solution. */
  showMistakes: boolean;
  /** Animate cells sliding to their new spots. */
  animateShifts: boolean;
  /** Light or dark appearance, or follow the system. */
  theme: ThemePreference;
  /** Colour pack id, see THEME_PACKS. */
  themePack: string;
  /** Skip the slide, flash and pop animations. */
  reduceMotion: boolean;
  /** Phantom challenge: filled cells fade away and lock for a while. */
  phantomMode: boolean;
  /** Which filled cells may fade. */
  phantomTarget: PhantomTarget;
  /** A new phantom appears after every N moves. */
  phantomEvery: number;
  /** A phantom cell stays locked for this many moves. */
  phantomLockMoves: number;
  /** Never more than this many phantoms at once, so progress stays possible. */
  phantomMax: number;
  /** How long the digit takes to fade out visually, in milliseconds. */
  phantomFadeMs: number;
  /** Show a ghost marker (and moves-left count) on locked cells. */
  phantomMarkers: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  difficulty: 'medium',
  enabledShifts: ALL_SHIFT_KINDS.filter((k) => k !== 'relabel'),
  shiftEvery: 1,
  shiftsPerMove: 1,
  shiftPreview: 'off',
  highlightConflicts: true,
  showMistakes: false,
  animateShifts: true,
  theme: 'system',
  themePack: 'classic',
  reduceMotion: false,
  phantomMode: false,
  phantomTarget: 'both',
  phantomEvery: 3,
  phantomLockMoves: 5,
  phantomMax: 3,
  phantomFadeMs: 4000,
  phantomMarkers: true,
};

/**
 * A cell whose digit has faded away. The digit is gone from `values` the
 * moment the phantom is created; the UI fades it out over `fadeMs` starting
 * at `startedAt`. Until `unlockAtMove` nothing may be entered in the cell.
 */
export interface Phantom {
  id: number;
  /** The digit that faded, for the fade-out animation and for undo. */
  value: number;
  /** Whether the faded digit was one of the puzzle's givens. */
  wasGiven: boolean;
  /** Wall-clock time the fade started (ms since epoch). */
  startedAt: number;
  fadeMs: number;
  createdAtMove: number;
  unlockAtMove: number;
  /**
   * Set once the lock has run out. The record then lingers, invisible, until
   * the cell is filled again so the game can tell whether the digit was
   * recalled correctly.
   */
  unlocked?: boolean;
}

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
  /** One entry per position; null where there is no phantom. */
  phantoms: (Phantom | null)[];
  lastPhantom: Phantom | null;
  phantomCount: number;
  /** Phantom cells refilled with the digit that had faded. */
  phantomsRecalled: number;
  /** Phantom cells refilled with a different digit. */
  phantomsMissed: number;
}

export type GameMode = 'free' | 'daily';

export interface GameState extends Snapshot {
  seed: number;
  settings: Settings;
  /** Free play, or the once-a-day shared puzzle. */
  mode: GameMode;
  /** Local calendar day (YYYY-MM-DD) for daily games, else null. */
  dailyKey: string | null;
  /** Seconds of play so far; advanced by 'tick'. */
  elapsed: number;
  notesMode: boolean;
  status: 'playing' | 'won';
  history: Snapshot[];
  /** Incremented every time the board changes; drives animations. */
  version: number;
  hintsUsed: number;
}

export type Action =
  | { type: 'select'; pos: number | null }
  | { type: 'input'; digit: number; now?: number }
  | { type: 'erase'; now?: number }
  | { type: 'toggleNotesMode' }
  | { type: 'undo' }
  | { type: 'hint'; now?: number }
  | { type: 'tick' }
  | { type: 'newGame'; settings?: Partial<Settings>; seed?: number }
  | { type: 'updateSettings'; settings: Partial<Settings> }
  /** Replaces the whole state, used when switching between saved games. */
  | { type: 'load'; state: GameState };

const MAX_HISTORY = 200;

export interface NewGameOptions {
  mode?: GameMode;
  dailyKey?: string | null;
}

export function newGame(
  settings: Settings,
  seed: number = randomSeed(),
  options: NewGameOptions = {},
): GameState {
  const rng = createRng(seed);
  const { clues, solution } = generatePuzzle(rng, settings.difficulty);
  return {
    seed,
    settings,
    mode: options.mode ?? 'free',
    dailyKey: options.dailyKey ?? null,
    elapsed: 0,
    solution,
    given: clues.map((v) => v !== 0),
    values: clues.slice(),
    notes: new Array<number>(CELLS).fill(0),
    tokens: Array.from({ length: CELLS }, (_, i) => i),
    selected: null,
    moves: 0,
    lastShift: null,
    shiftCount: 0,
    phantoms: new Array<Phantom | null>(CELLS).fill(null),
    lastPhantom: null,
    phantomCount: 0,
    phantomsRecalled: 0,
    phantomsMissed: 0,
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
    phantoms: s.phantoms,
    lastPhantom: s.lastPhantom,
    phantomCount: s.phantomCount,
    phantomsRecalled: s.phantomsRecalled,
    phantomsMissed: s.phantomsMissed,
  };
}

/** Per-game RNG for shifts, advanced by move count so shifts are reproducible. */
function shiftRng(state: GameState) {
  return createRng((state.seed ^ (state.moves * 0x9e3779b1)) >>> 0);
}

/** Separate stream for phantom picks so they never correlate with shifts. */
function phantomRng(state: GameState) {
  return createRng((state.seed ^ 0x5bd1e995 ^ (state.moves * 0x85ebca6b)) >>> 0);
}

/** True while nothing may be entered in the cell. */
export function isLocked(state: GameState, pos: number): boolean {
  const ph = state.phantoms[pos];
  return ph !== null && !ph.unlocked && state.moves < ph.unlockAtMove;
}

/** Locked phantoms only; unlocked records awaiting recall do not count. */
function lockedPhantomCount(state: GameState): number {
  let n = 0;
  for (let p = 0; p < CELLS; p++) if (isLocked(state, p)) n++;
  return n;
}

/**
 * Called when the player fills `pos`: if a faded digit was waiting to be
 * recalled there, score the attempt and retire the record.
 */
function scoreRecall(state: GameState, pos: number, digit: number): GameState {
  const ph = state.phantoms[pos];
  if (ph === null) return state;
  const phantoms = state.phantoms.slice();
  phantoms[pos] = null;
  const recalled = digit === ph.value;
  return {
    ...state,
    phantoms,
    phantomsRecalled: state.phantomsRecalled + (recalled ? 1 : 0),
    phantomsMissed: state.phantomsMissed + (recalled ? 0 : 1),
  };
}

/** Empty cells the player is currently allowed to fill. */
function playableEmptyCells(state: GameState): number {
  let n = 0;
  for (let p = 0; p < CELLS; p++) if (state.values[p] === 0 && !isLocked(state, p)) n++;
  return n;
}

/**
 * The player must always have somewhere to play, otherwise the locks could
 * never run out. If a move leaves no empty unlocked cell, every phantom
 * unlocks at once.
 */
function ensurePlayable(state: GameState): GameState {
  if (playableEmptyCells(state) > 0) return state;
  if (lockedPhantomCount(state) === 0) return state;
  return {
    ...state,
    phantoms: state.phantoms.map((ph) => (ph === null ? null : { ...ph, unlocked: true })),
  };
}

/** Marks phantoms whose lock has run out as unlocked. */
function expirePhantoms(state: GameState): GameState {
  const due = (ph: Phantom | null) => ph !== null && !ph.unlocked && state.moves >= ph.unlockAtMove;
  if (!state.phantoms.some(due)) return state;
  return {
    ...state,
    phantoms: state.phantoms.map((ph) => (due(ph) ? { ...ph!, unlocked: true } : ph)),
  };
}

/**
 * Turns one random eligible filled cell into a phantom: its digit leaves the
 * board and the cell locks for `phantomLockMoves` moves. `exclude` is the
 * cell the player just changed, which never fades on the same move.
 */
function spawnPhantom(state: GameState, exclude: number | null, now: number): GameState {
  const { phantomTarget, phantomLockMoves, phantomFadeMs, phantomMax } = state.settings;
  // Never take away the player's last playable cell.
  if (playableEmptyCells(state) === 0) return state;
  if (lockedPhantomCount(state) >= Math.max(1, phantomMax)) return state;
  const eligible: number[] = [];
  for (let p = 0; p < CELLS; p++) {
    if (p === exclude || state.values[p] === 0 || state.phantoms[p] !== null) continue;
    if (phantomTarget === 'entries' && state.given[p]) continue;
    if (phantomTarget === 'givens' && !state.given[p]) continue;
    eligible.push(p);
  }
  if (eligible.length === 0) return state;
  const pos = pick(phantomRng(state), eligible);
  const phantom: Phantom = {
    id: state.phantomCount + 1,
    value: state.values[pos],
    wasGiven: state.given[pos],
    startedAt: now,
    fadeMs: phantomFadeMs,
    createdAtMove: state.moves,
    unlockAtMove: state.moves + Math.max(1, phantomLockMoves),
  };
  const values = state.values.slice();
  values[pos] = 0;
  const given = state.given.slice();
  given[pos] = false;
  const notes = state.notes.slice();
  notes[pos] = 0;
  const phantoms = state.phantoms.slice();
  phantoms[pos] = phantom;
  return {
    ...state,
    values,
    given,
    notes,
    phantoms,
    lastPhantom: phantom,
    phantomCount: state.phantomCount + 1,
  };
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
    phantoms: permute(state.phantoms, shift).map((ph) =>
      ph === null ? null : { ...ph, value: shift.relabel[ph.value] },
    ),
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
function afterMove(
  prev: GameState,
  next: GameState,
  changed: number | null,
  now: number,
): GameState {
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
  s = expirePhantoms(s);
  if (s.settings.phantomMode) {
    const cadence = Math.max(1, s.settings.phantomEvery);
    if (moves % cadence === 0) s = spawnPhantom(s, changed, now);
  }
  s = ensurePlayable(s);
  const every = Math.max(1, s.settings.shiftEvery);
  if (moves % every === 0) {
    const rng = shiftRng(s);
    const count = Math.max(1, Math.min(4, s.settings.shiftsPerMove));
    for (let i = 0; i < count; i++) {
      const shift = randomShift(rng, s.settings.enabledShifts);
      if (!shift) break;
      s = applyShift(s, shift);
    }
  }
  return s;
}

export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'select':
      return { ...state, selected: action.pos };

    case 'toggleNotesMode':
      return { ...state, notesMode: !state.notesMode };

    case 'tick':
      return state.status === 'playing' ? { ...state, elapsed: state.elapsed + 1 } : state;

    case 'load':
      return action.state;

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
      if (isLocked(state, p)) return state;
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
      return afterMove(
        state,
        scoreRecall({ ...state, values, notes }, p, d),
        p,
        action.now ?? Date.now(),
      );
    }

    case 'erase': {
      const p = state.selected;
      if (state.status !== 'playing' || p === null || state.given[p]) return state;
      if (isLocked(state, p)) return state;
      if (state.values[p] === 0 && state.notes[p] === 0) return state;
      const values = state.values.slice();
      const notes = state.notes.slice();
      const wasValue = values[p] !== 0;
      values[p] = 0;
      notes[p] = 0;
      if (!wasValue) return { ...state, notes, version: state.version + 1 };
      return afterMove(state, { ...state, values, notes }, p, action.now ?? Date.now());
    }

    case 'hint': {
      const p = state.selected;
      if (state.status !== 'playing' || p === null || state.given[p]) return state;
      if (isLocked(state, p)) return state;
      if (state.values[p] === state.solution[p]) return state;
      const values = state.values.slice();
      values[p] = state.solution[p];
      const notes = state.notes.slice();
      notes[p] = 0;
      return afterMove(
        state,
        scoreRecall({ ...state, values, notes, hintsUsed: state.hintsUsed + 1 }, p, values[p]),
        p,
        action.now ?? Date.now(),
      );
    }
  }
}

/**
 * The shift that will fire after the next move, or null when the next move
 * does not trigger one. This reads the very same seeded stream `afterMove`
 * will use, so the preview is exact rather than a guess. A move that
 * completes the puzzle ends the game before any shift, which no preview can
 * know in advance.
 */
export function nextShift(state: GameState): Shift | null {
  if (state.status !== 'playing') return null;
  const moves = state.moves + 1;
  const every = Math.max(1, state.settings.shiftEvery);
  if (moves % every !== 0) return null;
  const rng = createRng((state.seed ^ (moves * 0x9e3779b1)) >>> 0);
  return randomShift(rng, state.settings.enabledShifts);
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
