import AsyncStorage from '@react-native-async-storage/async-storage';
import { CELLS, DEFAULT_SETTINGS, Difficulty, GameState, Settings } from './engine';

const GAME_KEY = 'sudokuoku:game:v1';
const HELP_SEEN_KEY = 'sudokuoku:helpSeen:v1';
const STATS_KEY = 'sudokuoku:stats:v1';

export interface DifficultyStats {
  played: number;
  won: number;
  /** Fastest win in seconds, or null if never won. */
  bestTime: number | null;
  /** Fewest shifts endured in a win, or null. */
  fewestShifts: number | null;
  /** Lifetime phantom recall tally across wins. */
  phantomsRecalled: number;
  phantomsMissed: number;
}

export type Stats = Record<Difficulty, DifficultyStats>;

const EMPTY_DIFFICULTY: DifficultyStats = {
  played: 0,
  won: 0,
  bestTime: null,
  fewestShifts: null,
  phantomsRecalled: 0,
  phantomsMissed: 0,
};

export const EMPTY_STATS: Stats = {
  easy: { ...EMPTY_DIFFICULTY },
  medium: { ...EMPTY_DIFFICULTY },
  hard: { ...EMPTY_DIFFICULTY },
  expert: { ...EMPTY_DIFFICULTY },
};

export async function loadStats(): Promise<Stats> {
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    if (!raw) return EMPTY_STATS;
    const parsed = JSON.parse(raw) as Partial<Stats>;
    const out: Stats = { ...EMPTY_STATS };
    for (const d of Object.keys(EMPTY_STATS) as Difficulty[]) {
      out[d] = { ...EMPTY_DIFFICULTY, ...(parsed[d] ?? {}) };
    }
    return out;
  } catch {
    return EMPTY_STATS;
  }
}

export async function saveStats(stats: Stats): Promise<void> {
  try {
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // best-effort
  }
}

/** Pure helper: folds one game's start into the stats. */
export function recordStart(stats: Stats, difficulty: Difficulty): Stats {
  const d = stats[difficulty];
  return { ...stats, [difficulty]: { ...d, played: d.played + 1 } };
}

/** Pure helper: folds one won game into the stats. */
export function recordWin(stats: Stats, state: GameState, elapsed: number): Stats {
  const difficulty = state.settings.difficulty;
  const d = stats[difficulty];
  return {
    ...stats,
    [difficulty]: {
      ...d,
      won: d.won + 1,
      bestTime: d.bestTime === null ? elapsed : Math.min(d.bestTime, elapsed),
      fewestShifts:
        d.fewestShifts === null ? state.shiftCount : Math.min(d.fewestShifts, state.shiftCount),
      phantomsRecalled: d.phantomsRecalled + state.phantomsRecalled,
      phantomsMissed: d.phantomsMissed + state.phantomsMissed,
    },
  };
}

export async function clearStats(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STATS_KEY);
  } catch {
    // best-effort
  }
}

export interface SavedGame {
  state: GameState;
  elapsed: number;
}

function looksLikeState(x: unknown): x is GameState {
  if (!x || typeof x !== 'object') return false;
  const s = x as Partial<GameState>;
  return (
    Array.isArray(s.values) &&
    s.values.length === CELLS &&
    Array.isArray(s.solution) &&
    Array.isArray(s.tokens) &&
    Array.isArray(s.given) &&
    typeof s.settings === 'object' &&
    s.settings !== null
  );
}

/** Fills in fields that older saves may lack. */
function normalize(state: GameState): GameState {
  return {
    ...state,
    settings: { ...DEFAULT_SETTINGS, ...state.settings },
    phantoms:
      Array.isArray(state.phantoms) && state.phantoms.length === CELLS
        ? state.phantoms
        : new Array(CELLS).fill(null),
    lastPhantom: state.lastPhantom ?? null,
    phantomCount: typeof state.phantomCount === 'number' ? state.phantomCount : 0,
    phantomsRecalled: typeof state.phantomsRecalled === 'number' ? state.phantomsRecalled : 0,
    phantomsMissed: typeof state.phantomsMissed === 'number' ? state.phantomsMissed : 0,
    history: Array.isArray(state.history) ? state.history : [],
  };
}

export async function loadGame(): Promise<SavedGame | null> {
  try {
    const raw = await AsyncStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedGame>;
    if (!looksLikeState(parsed.state)) return null;
    return {
      state: normalize(parsed.state),
      elapsed: typeof parsed.elapsed === 'number' ? parsed.elapsed : 0,
    };
  } catch {
    return null;
  }
}

export async function saveGame(saved: SavedGame): Promise<void> {
  try {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(saved));
  } catch {
    // Persisting is best-effort; the game keeps working without it.
  }
}

export async function hasSeenHelp(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(HELP_SEEN_KEY)) === '1';
  } catch {
    return true; // if storage is unavailable, do not nag on every launch
  }
}

export async function markHelpSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(HELP_SEEN_KEY, '1');
  } catch {
    // best-effort
  }
}

export type { Settings };
