/**
 * Daily challenge, streaks, XP, levels and badges. Pure functions over a
 * persisted Profile so everything here is testable without the UI.
 */
import { GameMode, GameState, Settings } from './game';
import { Difficulty } from './sudoku';
import { ALL_SHIFT_KINDS } from './transforms';

// ---------------------------------------------------------------------------
// Daily challenge

/** Local calendar day as YYYY-MM-DD. */
export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDateKey(key: string, days: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

/** FNV-1a hash of the key, so every player gets the same board on a day. */
export function dailySeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h ^ 0x5d0d0c0) >>> 0;
}

export interface DailyConfig {
  key: string;
  difficulty: Difficulty;
  /** Phantom days force the phantom challenge on. */
  phantom: boolean;
  /** Short label such as "Hard · Phantom day". */
  label: string;
}

const WEEKDAY_DIFFICULTY: Difficulty[] = [
  'expert', // Sunday
  'easy',
  'medium',
  'medium',
  'hard',
  'medium',
  'hard',
];

export function dailyConfig(key: string): DailyConfig {
  const day = parseDateKey(key).getDay();
  const difficulty = WEEKDAY_DIFFICULTY[day];
  const phantom = day === 0 || day === 3;
  const cap = difficulty[0].toUpperCase() + difficulty.slice(1);
  return { key, difficulty, phantom, label: phantom ? `${cap} · Phantom day` : cap };
}

/** The settings a daily game is played with: fixed rules, the player's assists. */
export function dailySettings(base: Settings, config: DailyConfig): Settings {
  return {
    ...base,
    difficulty: config.difficulty,
    enabledShifts: ALL_SHIFT_KINDS.filter((k) => k !== 'relabel'),
    shiftEvery: 1,
    shiftsPerMove: 1,
    phantomMode: config.phantom,
    phantomTarget: 'both',
    phantomEvery: 3,
    phantomLockMoves: 5,
    phantomMax: 3,
  };
}

/**
 * True when a daily game belongs to a day that has already passed. The app
 * can sit open across local midnight, so "is this the daily?" is never just a
 * question about the game's mode: yesterday's puzzle is finished business and
 * today's has to be built.
 */
export function isDailyStale(
  game: { mode: GameMode; dailyKey: string | null },
  todayKey: string,
): boolean {
  return game.mode === 'daily' && game.dailyKey !== todayKey;
}

/** The parts of a game the daily card and its button read. */
interface DailyView {
  mode: GameMode;
  dailyKey: string | null;
  status: 'playing' | 'won';
}

/**
 * True when the game on screen really is today's daily. Mode alone does not
 * answer that: a daily left on screen across midnight is yesterday's puzzle,
 * so the daily button would offer to go "back to the board" for a board that
 * tapping it destroys.
 */
export function isTodaysDaily(
  game: { mode: GameMode; dailyKey: string | null },
  todayKey: string,
): boolean {
  return game.mode === 'daily' && !isDailyStale(game, todayKey);
}

/**
 * True when today's daily has been started and not finished, whichever of the
 * two games holds it. Yesterday's daily does not count: it is not today's
 * puzzle, and switching to the daily replaces it rather than resuming it.
 */
export function todaysDailyInProgress(
  onScreen: DailyView,
  parked: DailyView | null,
  todayKey: string,
): boolean {
  const daily = isTodaysDaily(onScreen, todayKey) ? onScreen : parked;
  return !!daily && daily.dailyKey === todayKey && daily.status === 'playing';
}

export interface DailyResult {
  key: string;
  difficulty: Difficulty;
  phantom: boolean;
  elapsed: number;
  moves: number;
  shifts: number;
  hints: number;
  phantomsRecalled: number;
  phantomsMissed: number;
  xp: number;
}

/** The most freezes a player may bank at once. */
export const MAX_FREEZES = 3;

export type FrozenDays = Record<string, true>;

/** A day counts towards the streak when it was played or covered by a freeze. */
function dayHeld(
  daily: Record<string, DailyResult>,
  frozen: FrozenDays,
  key: string,
): boolean {
  return !!daily[key] || !!frozen[key];
}

/** Consecutive held dailies ending today, or yesterday if today is open. */
export function currentStreak(
  daily: Record<string, DailyResult>,
  todayKey: string,
  frozen: FrozenDays = {},
): number {
  let key = dayHeld(daily, frozen, todayKey) ? todayKey : shiftDateKey(todayKey, -1);
  let n = 0;
  while (dayHeld(daily, frozen, key)) {
    n++;
    key = shiftDateKey(key, -1);
  }
  return n;
}

/**
 * The streak to show for a profile: the same number everywhere, freezes
 * included. Call this rather than `currentStreak` directly, or one screen
 * ends up reporting a run that another screen says was broken.
 */
export function profileStreak(profile: Profile, todayKey: string): number {
  return currentStreak(profile.daily, todayKey, profile.frozenDays);
}

/** Calendar month of a date key, e.g. "2026-09". */
function monthOf(key: string): string {
  return key.slice(0, 7);
}

/**
 * Grants one freeze at the start of each calendar month, up to MAX_FREEZES.
 * The first call ever also grants one, so a new player has a safety net.
 */
export function grantMonthlyFreeze(profile: Profile, todayKey: string): Profile {
  const month = monthOf(todayKey);
  if (profile.lastFreezeGrant === month) return profile;
  return {
    ...profile,
    freezes: Math.min(MAX_FREEZES, profile.freezes + 1),
    lastFreezeGrant: month,
  };
}

/**
 * Spends a freeze to cover yesterday, but only when that actually rescues a
 * streak: there must be a run to save behind it, and a freeze is never spent
 * on a streak that is already broken further back.
 */
export function applyStreakFreeze(profile: Profile, todayKey: string): Profile {
  if (profile.freezes <= 0) return profile;
  const yesterday = shiftDateKey(todayKey, -1);
  if (dayHeld(profile.daily, profile.frozenDays, yesterday)) return profile;
  const before = shiftDateKey(yesterday, -1);
  if (!dayHeld(profile.daily, profile.frozenDays, before)) return profile;
  return {
    ...profile,
    freezes: profile.freezes - 1,
    frozenDays: { ...profile.frozenDays, [yesterday]: true },
  };
}

/** Both of the above, run once when the app opens. */
export function refreshStreak(profile: Profile, todayKey: string): Profile {
  return applyStreakFreeze(grantMonthlyFreeze(profile, todayKey), todayKey);
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Wordle-style share text. */
export function shareText(result: DailyResult, streak: number): string {
  const cfg = dailyConfig(result.key);
  const lines = [
    `Sudokuoku Daily ${result.key} · ${cfg.label}`,
    `⏱ ${formatClock(result.elapsed)} · ${result.moves} moves · ${result.shifts} shifts` +
      (result.phantom ? ` · 👻 ${result.phantomsRecalled}/${result.phantomsRecalled + result.phantomsMissed}` : '') +
      (result.hints > 0 ? ` · 💡 ${result.hints}` : ' · no hints'),
    `🔥 ${streak} day streak · +${result.xp} XP`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// XP and levels

const BASE_XP: Record<Difficulty, number> = {
  easy: 50,
  medium: 100,
  hard: 175,
  expert: 275,
};

/** XP for a won game. */
export function xpForWin(state: GameState): number {
  const base = BASE_XP[state.settings.difficulty];
  const shifts = Math.min(100, state.shiftCount);
  const recalls = state.phantomsRecalled * 10;
  const hints = state.hintsUsed * 15;
  const raw = base + shifts + recalls - hints;
  const withDaily = state.mode === 'daily' ? Math.round(raw * 1.5) : raw;
  return Math.max(10, withDaily);
}

const TITLES: [number, string][] = [
  [1, 'Newcomer'],
  [2, 'Apprentice'],
  [3, 'Shifter'],
  [5, 'Ring Walker'],
  [8, 'Band Bender'],
  [12, 'Phantom Whisperer'],
  [16, 'Grid Master'],
  [20, 'Sudokuoku Sage'],
];

export interface LevelInfo {
  level: number;
  title: string;
  /** XP accumulated inside the current level. */
  into: number;
  /** XP needed to finish the current level. */
  span: number;
  /** Total XP at which the next level starts. */
  nextAt: number;
}

/** Total XP needed to reach `level` (level 1 starts at 0). */
export function xpForLevel(level: number): number {
  return 100 * (level - 1) * (level - 1);
}

export function levelInfo(xp: number): LevelInfo {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
  const start = xpForLevel(level);
  const nextAt = xpForLevel(level + 1);
  let title = TITLES[0][1];
  for (const [min, t] of TITLES) if (level >= min) title = t;
  return { level, title, into: xp - start, span: nextAt - start, nextAt };
}

// ---------------------------------------------------------------------------
// Profile

/**
 * A win with more than this many hints is recorded, but does not count
 * towards badges that claim skill. Hints fill in the answer, so a board
 * solved mostly by hints was not really solved.
 */
export const CLEAN_HINT_LIMIT = 3;

export function isCleanWin(state: GameState): boolean {
  return state.hintsUsed <= CLEAN_HINT_LIMIT;
}

export interface DifficultyStats {
  played: number;
  won: number;
  /** Wins within the hint limit. */
  cleanWins: number;
  bestTime: number | null;
  fewestShifts: number | null;
  phantomsRecalled: number;
  phantomsMissed: number;
}

export type Stats = Record<Difficulty, DifficultyStats>;

export interface Totals {
  played: number;
  won: number;
  cleanWins: number;
  shifts: number;
  phantomsRecalled: number;
  phantomsMissed: number;
  hintlessWins: number;
  dailiesCompleted: number;
}

export interface Profile {
  version: 1;
  xp: number;
  /** Badge id -> ISO timestamp of unlock. */
  badges: Record<string, string>;
  stats: Stats;
  totals: Totals;
  daily: Record<string, DailyResult>;
  bestStreak: number;
  /** Unspent streak freezes. */
  freezes: number;
  /** Days rescued by a freeze. */
  frozenDays: FrozenDays;
  /** Calendar month of the last monthly grant, e.g. "2026-09". */
  lastFreezeGrant: string | null;
}

const EMPTY_DIFFICULTY: DifficultyStats = {
  played: 0,
  won: 0,
  cleanWins: 0,
  bestTime: null,
  fewestShifts: null,
  phantomsRecalled: 0,
  phantomsMissed: 0,
};

export function emptyStats(): Stats {
  return {
    easy: { ...EMPTY_DIFFICULTY },
    medium: { ...EMPTY_DIFFICULTY },
    hard: { ...EMPTY_DIFFICULTY },
    expert: { ...EMPTY_DIFFICULTY },
  };
}

export function emptyProfile(): Profile {
  return {
    version: 1,
    xp: 0,
    badges: {},
    stats: emptyStats(),
    totals: {
      played: 0,
      won: 0,
      cleanWins: 0,
      shifts: 0,
      phantomsRecalled: 0,
      phantomsMissed: 0,
      hintlessWins: 0,
      dailiesCompleted: 0,
    },
    daily: {},
    bestStreak: 0,
    freezes: 0,
    frozenDays: {},
    lastFreezeGrant: null,
  };
}

/** Fills in anything an older or partial profile lacks. */
export function normalizeProfile(raw: unknown): Profile {
  const empty = emptyProfile();
  if (!raw || typeof raw !== 'object') return empty;
  const p = raw as Partial<Profile>;
  const stats = emptyStats();
  for (const d of Object.keys(stats) as Difficulty[]) {
    stats[d] = { ...EMPTY_DIFFICULTY, ...(p.stats?.[d] ?? {}) };
  }
  return {
    version: 1,
    xp: typeof p.xp === 'number' ? p.xp : 0,
    badges: p.badges && typeof p.badges === 'object' ? p.badges : {},
    stats,
    totals: { ...empty.totals, ...(p.totals ?? {}) },
    daily: p.daily && typeof p.daily === 'object' ? p.daily : {},
    bestStreak: typeof p.bestStreak === 'number' ? p.bestStreak : 0,
    freezes: typeof p.freezes === 'number' ? p.freezes : 0,
    frozenDays: p.frozenDays && typeof p.frozenDays === 'object' ? p.frozenDays : {},
    lastFreezeGrant: typeof p.lastFreezeGrant === 'string' ? p.lastFreezeGrant : null,
  };
}

export function recordGameStart(profile: Profile, difficulty: Difficulty): Profile {
  const d = profile.stats[difficulty];
  return {
    ...profile,
    stats: { ...profile.stats, [difficulty]: { ...d, played: d.played + 1 } },
    totals: { ...profile.totals, played: profile.totals.played + 1 },
  };
}

// ---------------------------------------------------------------------------
// Badges

export interface Badge {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** Group used to order the badge grid. */
  group: 'wins' | 'shifts' | 'phantom' | 'daily' | 'style';
}

interface WinContext {
  state: GameState;
  profile: Profile; // already updated with this win
  streak: number;
  /** The win was within the hint limit. */
  clean: boolean;
}

type Check = (ctx: WinContext) => boolean;

const defs: [Badge, Check][] = [
  [{ id: 'first-win', title: 'First Light', description: 'Win your first game.', icon: '✨', group: 'wins' }, ({ profile }) => profile.totals.won >= 1],
  [{ id: 'wins-10', title: 'Regular', description: 'Win 10 games.', icon: '🔟', group: 'wins' }, ({ profile }) => profile.totals.won >= 10],
  [{ id: 'wins-50', title: 'Veteran', description: 'Win 50 games.', icon: '🎖', group: 'wins' }, ({ profile }) => profile.totals.won >= 50],
  [{ id: 'wins-100', title: 'Centurion', description: 'Win 100 games.', icon: '💯', group: 'wins' }, ({ profile }) => profile.totals.won >= 100],
  [{ id: 'win-hard', title: 'Hard Headed', description: 'Win a hard game on your own.', icon: '🪨', group: 'wins' }, ({ profile }) => profile.stats.hard.cleanWins >= 1],
  [{ id: 'win-expert', title: 'Unshakeable', description: 'Win an expert game on your own.', icon: '🏔', group: 'wins' }, ({ profile }) => profile.stats.expert.cleanWins >= 1],
  [{ id: 'all-difficulties', title: 'Full Spectrum', description: 'Win at every difficulty on your own.', icon: '🌈', group: 'wins' }, ({ profile }) => (['easy', 'medium', 'hard', 'expert'] as Difficulty[]).every((d) => profile.stats[d].cleanWins >= 1)],
  [{ id: 'speed', title: 'Quick Hands', description: 'Win a medium or harder game in under 10 minutes, with at most two hints.', icon: '⚡', group: 'wins' }, ({ state }) => state.settings.difficulty !== 'easy' && state.elapsed < 600 && state.hintsUsed <= 2],
  [{ id: 'no-hints', title: 'Unassisted', description: 'Win without using a hint.', icon: '🧠', group: 'style' }, ({ state }) => state.hintsUsed === 0],
  [{ id: 'hintless-10', title: 'Self Reliant', description: 'Win 10 games without hints.', icon: '🦉', group: 'style' }, ({ profile }) => profile.totals.hintlessWins >= 10],
  [{ id: 'shifts-100', title: 'Sea Legs', description: 'Survive 100 shifts in total.', icon: '🌊', group: 'shifts' }, ({ profile }) => profile.totals.shifts >= 100],
  [{ id: 'shifts-1000', title: 'Storm Rider', description: 'Survive 1,000 shifts in total.', icon: '🌀', group: 'shifts' }, ({ profile }) => profile.totals.shifts >= 1000],
  [{ id: 'shifts-5000', title: 'Tectonic', description: 'Survive 5,000 shifts in total.', icon: '🌋', group: 'shifts' }, ({ profile }) => profile.totals.shifts >= 5000],
  [{ id: 'all-shifts', title: 'Everything Moves', description: 'Win with every shift kind enabled, digit shift included.', icon: '🎡', group: 'shifts' }, ({ state, clean }) => clean && ALL_SHIFT_KINDS.every((k) => state.settings.enabledShifts.includes(k))],
  [{ id: 'relabel', title: 'Renumbered', description: 'Win with the digit shift enabled.', icon: '🔢', group: 'shifts' }, ({ state, clean }) => clean && state.settings.enabledShifts.includes('relabel')],
  [{ id: 'phantom-first', title: 'Ghost Story', description: 'Recall a faded digit correctly.', icon: '👻', group: 'phantom' }, ({ profile }) => profile.totals.phantomsRecalled >= 1],
  [{ id: 'phantom-perfect', title: 'Total Recall', description: 'Win with five or more phantoms and no misses.', icon: '🧿', group: 'phantom' }, ({ state, clean }) => clean && state.phantomCount >= 5 && state.phantomsMissed === 0 && state.phantomsRecalled >= 5],
  [{ id: 'phantom-blind', title: 'Blindfold', description: 'Win a phantom game with the markers switched off.', icon: '🕶', group: 'phantom' }, ({ state, clean }) => clean && state.settings.phantomMode && !state.settings.phantomMarkers && state.phantomCount >= 3],
  [{ id: 'phantom-100', title: 'Medium', description: 'Recall 100 faded digits in total.', icon: '🔮', group: 'phantom' }, ({ profile }) => profile.totals.phantomsRecalled >= 100],
  [{ id: 'daily-first', title: 'Day One', description: 'Complete a daily challenge.', icon: '📅', group: 'daily' }, ({ profile }) => profile.totals.dailiesCompleted >= 1],
  [{ id: 'streak-3', title: 'Warming Up', description: 'Keep a 3 day streak.', icon: '🔥', group: 'daily' }, ({ streak }) => streak >= 3],
  [{ id: 'streak-7', title: 'One Week', description: 'Keep a 7 day streak.', icon: '📆', group: 'daily' }, ({ streak }) => streak >= 7],
  [{ id: 'streak-30', title: 'Habit', description: 'Keep a 30 day streak.', icon: '🏆', group: 'daily' }, ({ streak }) => streak >= 30],
  [{ id: 'daily-phantom', title: 'Sunday Séance', description: 'Complete a phantom day daily.', icon: '🕯', group: 'daily' }, ({ state }) => state.mode === 'daily' && state.settings.phantomMode],
];

export const BADGES: Badge[] = defs.map(([b]) => b);

export interface WinOutcome {
  profile: Profile;
  xpGained: number;
  newBadges: Badge[];
  leveledUp: boolean;
  streak: number;
}

/**
 * Folds a won game into the profile: stats, totals, XP, daily result and
 * any badges that just unlocked. `now` is the moment of the win.
 */
export function recordGameWin(profile: Profile, state: GameState, now: Date): WinOutcome {
  const difficulty = state.settings.difficulty;
  const d = profile.stats[difficulty];
  const xpGained = xpForWin(state);
  const clean = isCleanWin(state);
  const before = levelInfo(profile.xp).level;

  let next: Profile = {
    ...profile,
    xp: profile.xp + xpGained,
    stats: {
      ...profile.stats,
      [difficulty]: {
        ...d,
        won: d.won + 1,
        cleanWins: d.cleanWins + (clean ? 1 : 0),
        bestTime: d.bestTime === null ? state.elapsed : Math.min(d.bestTime, state.elapsed),
        fewestShifts:
          d.fewestShifts === null ? state.shiftCount : Math.min(d.fewestShifts, state.shiftCount),
        phantomsRecalled: d.phantomsRecalled + state.phantomsRecalled,
        phantomsMissed: d.phantomsMissed + state.phantomsMissed,
      },
    },
    totals: {
      ...profile.totals,
      won: profile.totals.won + 1,
      cleanWins: profile.totals.cleanWins + (clean ? 1 : 0),
      shifts: profile.totals.shifts + state.shiftCount,
      phantomsRecalled: profile.totals.phantomsRecalled + state.phantomsRecalled,
      phantomsMissed: profile.totals.phantomsMissed + state.phantomsMissed,
      hintlessWins: profile.totals.hintlessWins + (state.hintsUsed === 0 ? 1 : 0),
    },
  };

  if (state.mode === 'daily' && state.dailyKey && !next.daily[state.dailyKey]) {
    const result: DailyResult = {
      key: state.dailyKey,
      difficulty,
      phantom: state.settings.phantomMode,
      elapsed: state.elapsed,
      moves: state.moves,
      shifts: state.shiftCount,
      hints: state.hintsUsed,
      phantomsRecalled: state.phantomsRecalled,
      phantomsMissed: state.phantomsMissed,
      xp: xpGained,
    };
    next = {
      ...next,
      daily: { ...next.daily, [state.dailyKey]: result },
      totals: { ...next.totals, dailiesCompleted: next.totals.dailiesCompleted + 1 },
    };
  }

  const streak = currentStreak(next.daily, state.dailyKey ?? dateKey(now), next.frozenDays);
  next = { ...next, bestStreak: Math.max(next.bestStreak, streak) };

  const ctx: WinContext = { state, profile: next, streak, clean };
  const newBadges: Badge[] = [];
  const badges = { ...next.badges };
  for (const [badge, check] of defs) {
    if (badges[badge.id]) continue;
    if (check(ctx)) {
      badges[badge.id] = now.toISOString();
      newBadges.push(badge);
    }
  }
  next = { ...next, badges };

  return {
    profile: next,
    xpGained,
    newBadges,
    leveledUp: levelInfo(next.xp).level > before,
    streak,
  };
}
