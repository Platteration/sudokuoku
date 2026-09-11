/**
 * The storage boundary: the shape a game is written in, and how much of a
 * save is believed when one comes back.
 *
 * Everything here is pure so it can be tested without a renderer or a
 * storage backend; `src/storage.ts` is only the AsyncStorage plumbing around
 * it. Two things drive the checks below.
 *
 * A save is untrusted input. On the web build AsyncStorage is localStorage,
 * which anything on the origin can edit, and on a device a bad backup restore
 * does the same job. A save that is merely *shaped* like a game — 81 values,
 * four arrays — can still carry token indices that are out of range, or an
 * `enabledShifts` that is not a list of shift kinds, and those crash the board
 * or the first move. Because nothing in the app clears a save by hand, a
 * corrupt one that passes validation wedges every launch from then on. So the
 * rule is: reject what cannot be repaired, repair what can, and never hand
 * back a state the reducer or the board can trip over.
 *
 * And a save is written on every board change, so it has to stay small: the
 * in-memory undo history is far longer than anything worth keeping across a
 * restart, and serialising all of it costs a JSON pass and a storage write on
 * the JS thread at the exact moment a shift starts animating.
 */
import {
  ALL_SHIFT_KINDS,
  CELLS,
  DEFAULT_SETTINGS,
  GameState,
  Phantom,
  Settings,
  ShiftKind,
  dailyConfig,
  dailySettings,
  isDateKey,
} from '../engine';

/**
 * Undo steps kept on disk. The game keeps far more in memory (MAX_HISTORY);
 * this is only what survives a restart, and each snapshot costs 2 to 3.5 kB of
 * JSON — five 81-cell arrays, the phantoms, and a shift event carrying another
 * 81-entry permutation. Twenty is deep enough to undo a mistake noticed after
 * a break, and holds a long game to roughly 45-60 kB rather than 430-590 kB.
 */
export const PERSISTED_HISTORY = 20;

/** What gets written to storage: the game, minus most of its undo history. */
export function forStorage(state: GameState): GameState {
  if (state.history.length <= PERSISTED_HISTORY) return state;
  return { ...state, history: state.history.slice(-PERSISTED_HISTORY) };
}

// ---------------------------------------------------------------------------
// Settings

const SETTING_VALUES: Partial<Record<keyof Settings, readonly string[]>> = {
  difficulty: ['easy', 'medium', 'hard', 'expert'],
  shiftPreview: ['off', 'category', 'exact'],
  theme: ['system', 'light', 'dark'],
  phantomTarget: ['entries', 'givens', 'both'],
};

/** True when `value` may stand in for the default of that setting. */
function settingOk(key: keyof Settings, value: unknown): boolean {
  const allowed = SETTING_VALUES[key];
  if (allowed) return typeof value === 'string' && allowed.includes(value);
  const fallback = DEFAULT_SETTINGS[key];
  if (typeof fallback === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === typeof fallback;
}

/**
 * Settings from outside, made safe. Anything missing, of the wrong type or
 * outside the values the app knows falls back to the default. `enabledShifts`
 * matters most: a stray string there makes `randomShift` return undefined and
 * the first move of the game throws.
 */
export function cleanSettings(raw: unknown): Settings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (key === 'enabledShifts') continue;
    if (settingOk(key, src[key])) (out as Record<string, unknown>)[key] = src[key];
  }
  const shifts = src.enabledShifts;
  out.enabledShifts = Array.isArray(shifts)
    ? ALL_SHIFT_KINDS.filter((k) => shifts.includes(k))
    : DEFAULT_SETTINGS.enabledShifts;
  return out;
}

// ---------------------------------------------------------------------------
// Shared settings

/**
 * Settings that follow the player rather than the game: appearance and
 * assistance. They are stored on their own, outside either game's state,
 * because both games carry a full copy of the settings and only one of them
 * is on screen when a preference changes. Kept in the game states alone, a
 * change made during the daily is overwritten by the free game's older copy
 * on the next switch, and lost entirely on the next launch.
 */
export const SHARED_SETTING_KEYS = [
  'highlightConflicts',
  'showMistakes',
  'animateShifts',
  'theme',
  'themePack',
  'shiftPreview',
  'reduceMotion',
  'phantomMarkers',
  'phantomFadeMs',
] as const;

export type SharedSettingKey = (typeof SHARED_SETTING_KEYS)[number];
export type SharedSettings = Partial<Pick<Settings, SharedSettingKey>>;

/** The player-level settings of a game, for storing or copying across. */
export function pickShared(settings: Settings): SharedSettings {
  const out: Record<string, unknown> = {};
  for (const key of SHARED_SETTING_KEYS) out[key] = settings[key];
  return out as SharedSettings;
}

/** Overlays stored shared settings on a game's own, ignoring anything else. */
export function applyShared(settings: Settings, raw: unknown): Settings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...settings };
  for (const key of SHARED_SETTING_KEYS) {
    if (settingOk(key, src[key])) (out as Record<string, unknown>)[key] = src[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Saved games

function isDigitGrid(x: unknown): x is number[] {
  return (
    Array.isArray(x) &&
    x.length === CELLS &&
    x.every((v) => Number.isInteger(v) && v >= 0 && v <= 9)
  );
}

function isFlagGrid(x: unknown): x is boolean[] {
  return Array.isArray(x) && x.length === CELLS && x.every((v) => typeof v === 'boolean');
}

/** Token ids are indices into the board, and every cell holds exactly one. */
function isTokenPermutation(x: unknown): x is number[] {
  if (!Array.isArray(x) || x.length !== CELLS) return false;
  const seen = new Set<number>();
  for (const v of x) {
    if (!Number.isInteger(v) || v < 0 || v >= CELLS || seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}

/** The board itself: without all of this there is no game to restore. */
function hasBoard(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  return (
    isDigitGrid(s.values) &&
    isDigitGrid(s.solution) &&
    isFlagGrid(s.given) &&
    isTokenPermutation(s.tokens)
  );
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * A counter, made safe: whole and never negative. XP, the badges and the best
 * times are read straight off these, and `num` alone would let a save that
 * claims -100 hints buy a clean win and 1,500 XP.
 */
const count = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;

const noteGrid = (x: unknown): number[] =>
  Array.isArray(x) && x.length === CELLS && x.every((v) => Number.isInteger(v) && v >= 0)
    ? (x as number[])
    : new Array<number>(CELLS).fill(0);

const position = (v: unknown): number | null =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < CELLS ? (v as number) : null;

function phantom(x: unknown): Phantom | null {
  if (!x || typeof x !== 'object') return null;
  const p = x as Record<string, unknown>;
  if (![p.id, p.value, p.unlockAtMove, p.createdAtMove].every((v) => typeof v === 'number')) {
    return null;
  }
  return {
    id: p.id as number,
    value: p.value as number,
    wasGiven: p.wasGiven === true,
    startedAt: num(p.startedAt, 0),
    fadeMs: num(p.fadeMs, 0),
    createdAtMove: p.createdAtMove as number,
    unlockAtMove: p.unlockAtMove as number,
    unlocked: p.unlocked === true ? true : undefined,
  };
}

function phantomGrid(x: unknown): (Phantom | null)[] {
  if (!Array.isArray(x) || x.length !== CELLS) return new Array<Phantom | null>(CELLS).fill(null);
  return x.map(phantom);
}

function shiftEvent(x: unknown): GameState['lastShift'] {
  if (!x || typeof x !== 'object') return null;
  const e = x as Record<string, unknown>;
  const relabel = e.relabel;
  const validRelabel =
    Array.isArray(relabel) &&
    relabel.length === 10 &&
    relabel.every((v) => Number.isInteger(v) && v >= 0 && v <= 9);
  if (
    !ALL_SHIFT_KINDS.includes(e.kind as ShiftKind) ||
    typeof e.description !== 'string' ||
    !isTokenPermutation(e.dest) ||
    !validRelabel ||
    typeof e.afterMove !== 'number'
  ) {
    return null;
  }
  return {
    kind: e.kind as ShiftKind,
    description: e.description,
    dest: e.dest,
    relabel: relabel as number[],
    afterMove: e.afterMove,
  };
}

type Snapshot = GameState['history'][number];

/** One board state, repaired. Null when there is no board in it at all. */
function readSnapshot(raw: unknown): Snapshot | null {
  if (!hasBoard(raw)) return null;
  const s = raw as Record<string, unknown>;
  return {
    solution: s.solution as number[],
    given: s.given as boolean[],
    values: s.values as number[],
    tokens: s.tokens as number[],
    notes: noteGrid(s.notes),
    selected: position(s.selected),
    moves: count(s.moves, 0),
    lastShift: shiftEvent(s.lastShift),
    shiftCount: count(s.shiftCount, 0),
    phantoms: phantomGrid(s.phantoms),
    lastPhantom: phantom(s.lastPhantom),
    phantomCount: count(s.phantomCount, 0),
    phantomsRecalled: count(s.phantomsRecalled, 0),
    phantomsMissed: count(s.phantomsMissed, 0),
  };
}

/** Which of the two stored games a save was read out of. */
export type GameSlot = 'free' | 'daily';

/**
 * Restores one game from a parsed save, or null when there is no usable game
 * in it. Fields the app can rebuild are repaired rather than rejected, so an
 * older or slightly damaged save keeps its board instead of being thrown away.
 *
 * What kind of game it is comes from the slot it was read out of, not from the
 * save: the app writes a daily to the daily key and a free game to the free
 * one, so a save that says otherwise is one that was edited. Believed, it
 * hands a daily-mode game to the free game's restore — which has no staleness
 * check, because only the daily slot was ever asked for one — and completing
 * it mints a daily result, a streak and badges for whatever date it names.
 */
export function readSavedGame(parsed: unknown, slot: GameSlot): GameState | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const wrapper = parsed as { state?: unknown; elapsed?: unknown };
  // Older saves wrapped the state as { state, elapsed }.
  const raw = hasBoard(parsed) ? parsed : wrapper.state;
  const board = readSnapshot(raw);
  if (!board) return null;
  const s = raw as Record<string, unknown>;
  // A daily with no real day is not a daily at all, so there is nothing in
  // that slot worth restoring: the key is what the result is filed under, what
  // the rules below are rebuilt from, and what the streak is walked back from
  // the moment the game is won.
  const dailyKey = slot === 'daily' && isDateKey(s.dailyKey) ? s.dailyKey : null;
  if (slot === 'daily' && dailyKey === null) return null;
  const settings = cleanSettings(s.settings);
  return {
    ...board,
    // The daily's rules are a function of its date, so they are rebuilt from
    // the day rather than read back: the save only carries the player's own
    // assists. Otherwise a save claiming expert buys the expert XP.
    settings: dailyKey ? dailySettings(settings, dailyConfig(dailyKey)) : settings,
    seed: num(s.seed, 0),
    mode: dailyKey ? 'daily' : 'free',
    dailyKey,
    elapsed: count(s.elapsed, count(wrapper.elapsed, 0)),
    notesMode: s.notesMode === true,
    status: s.status === 'won' ? 'won' : 'playing',
    version: num(s.version, 0),
    hintsUsed: count(s.hintsUsed, 0),
    history: (Array.isArray(s.history) ? s.history : [])
      .map(readSnapshot)
      .filter((snap): snap is Snapshot => snap !== null),
  };
}
