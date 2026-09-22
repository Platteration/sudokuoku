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

type Fields = Record<string, unknown>;

/** The own fields of a stored object; anything that is not an object has none. */
export function fields(raw: unknown): Fields {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Fields) : {};
}

/**
 * True when `value` is one of `table`'s own keys — never an inherited one.
 * Every name on `Object.prototype` (`constructor`, `__proto__`, `toString`)
 * is truthy on a plain object table, so `value in table` or a bare
 * `table[value]` would pass any of them as a valid setting.
 */
function has<T extends string>(table: Readonly<Record<T, unknown>>, value: unknown): value is T {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(table, value);
}

/** `value` when it is one of `table`'s own keys, else `fallback`. */
export function pick<T extends string>(value: unknown, table: Readonly<Record<T, unknown>>, fallback: T): T {
  return has(table, value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** The settings whose values come from a closed set. */
export type EnumSettingKey = 'difficulty' | 'shiftPreview' | 'theme' | 'phantomTarget' | 'reduceMotion';

/**
 * Every value each of those settings may hold. Typed against `Settings`
 * itself, so a member added to a type without being added here — or dropped
 * here while a player still has it stored — fails the type check rather than
 * quietly sending that player back to the default.
 */
export const SETTING_VALUES: { readonly [K in EnumSettingKey]: Readonly<Record<Settings[K], true>> } = {
  difficulty: { easy: true, medium: true, hard: true, expert: true },
  shiftPreview: { off: true, category: true, exact: true },
  theme: { system: true, light: true, dark: true },
  phantomTarget: { entries: true, givens: true, both: true },
  reduceMotion: { system: true, on: true, off: true },
};

function isEnumSetting(key: keyof Settings): key is EnumSettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_VALUES, key);
}

/**
 * The stored value of one setting when it may stand in for the default, else
 * undefined. `enabledShifts` is a list and is rebuilt by its callers.
 */
export function settingValue<K extends keyof Settings>(key: K, value: unknown): Settings[K] | undefined {
  // Reduce motion was a boolean until it learned to follow the system. `true`
  // was a choice and stays one; `false` was the default nobody chose, so it
  // becomes the new default rather than `'off'`, which would override an OS
  // preference the player never asked to override.
  if (key === 'reduceMotion' && typeof value === 'boolean') value = value ? 'on' : 'system';
  if (isEnumSetting(key)) {
    const table = SETTING_VALUES[key] as Readonly<Record<string, true>>;
    return has(table, value) ? (value as Settings[K]) : undefined;
  }
  const fallback = DEFAULT_SETTINGS[key];
  if (typeof fallback === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? (value as Settings[K]) : undefined;
  }
  return typeof value === typeof fallback ? (value as Settings[K]) : undefined;
}

/** True when `value` may stand in for the default of that setting. */
export function settingOk(key: keyof Settings, value: unknown): boolean {
  return settingValue(key, value) !== undefined;
}

/**
 * Settings from outside, made safe. Anything missing, of the wrong type or
 * outside the values the app knows falls back to the default. `enabledShifts`
 * matters most: a stray string there makes `randomShift` return undefined and
 * the first move of the game throws.
 */
export function cleanSettings(raw: unknown): Settings {
  const src = fields(raw);
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (key === 'enabledShifts') continue;
    const value = settingValue(key, src[key]);
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
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
  'haptics',
] as const;

export type SharedSettingKey = (typeof SHARED_SETTING_KEYS)[number];
export type SharedSettings = Partial<Pick<Settings, SharedSettingKey>>;

/**
 * The record the shared settings are stored in: the settings themselves and
 * whether the player has seen the introduction. The flag rides with the
 * settings because it is one more thing that belongs to the player rather
 * than to a game, but it is not a preference: a reset leaves it alone.
 *
 * `seenIntro` is `null` when the store could not be read this launch. The
 * screen keeps the introduction closed on it, so a device that cannot persist
 * is not asked to read it every launch, and it is never written: only a
 * boolean that was read back, or set by closing the introduction, reaches the
 * record. Written, one transient read failure would hide the first-run help
 * for good.
 */
export interface SharedRecord {
  settings: SharedSettings;
  seenIntro: boolean | null;
}

/** The player-level settings of a game, for storing or copying across. */
export function pickShared(settings: Settings): SharedSettings {
  const out: Record<string, unknown> = {};
  for (const key of SHARED_SETTING_KEYS) out[key] = settings[key];
  return out as SharedSettings;
}

/** The shared settings as they started: what a reset puts back. */
export function defaultShared(): SharedSettings {
  return pickShared(DEFAULT_SETTINGS);
}

/** Overlays stored shared settings on a game's own, ignoring anything else. */
export function applyShared(settings: Settings, raw: unknown): Settings {
  const src = fields(raw);
  const out = { ...settings };
  for (const key of SHARED_SETTING_KEYS) {
    const value = settingValue(key, src[key]);
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * A stored shared record, believed only where it is valid: the settings it
 * carries that the app knows, and the intro flag when it is a boolean. A
 * missing flag means the introduction has not been seen.
 */
export function cleanSharedRecord(raw: unknown): SharedRecord {
  const src = fields(raw);
  const settings: Record<string, unknown> = {};
  for (const key of SHARED_SETTING_KEYS) {
    const value = settingValue(key, src[key]);
    if (value !== undefined) settings[key] = value;
  }
  return { settings: settings as SharedSettings, seenIntro: bool(src.seenIntro, false) };
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
