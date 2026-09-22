import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, GameState, dailyConfig, dailySeed, dailySettings, newGame } from '../engine';

/**
 * AsyncStorage, in memory. The store is the point of these tests: which record
 * a game is written to and read back from is what decides how much of it is
 * believed, so the two have to be watched from outside the module.
 */
const store = new Map<string, string>();
/** Faults the store can be put into: a full disk, or no store at all. */
const fault = { writes: false, all: false };
const failing = () => {
  if (fault.all) throw new Error('storage unavailable');
};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      failing();
      return store.has(key) ? store.get(key)! : null;
    },
    setItem: async (key: string, value: string) => {
      failing();
      if (fault.writes) throw new Error('quota exceeded');
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      failing();
      store.delete(key);
    },
  },
}));

const {
  KEYS,
  LEGACY_KEYS,
  clearDailyGame,
  loadDailyGame,
  loadGame,
  loadSharedSettings,
  saveDailyGame,
  saveGame,
  saveSharedSettings,
} = await import('../storage');

/** The records on disk, spelled out: an existing player's games live here. */
const FREE_KEY = 'sudokuoku:game:v1';
const DAILY_KEY = 'sudokuoku:daily:v1';

const freeGame = (over: Partial<GameState> = {}): GameState => ({
  ...newGame({ ...DEFAULT_SETTINGS, difficulty: 'hard' }, 11),
  ...over,
});

const dailyGame = (key: string): GameState =>
  newGame(dailySettings(DEFAULT_SETTINGS, dailyConfig(key)), dailySeed(key), {
    mode: 'daily',
    dailyKey: key,
  });

beforeEach(() => {
  store.clear();
  fault.writes = false;
  fault.all = false;
});

describe('which record a game is stored in', () => {
  it('writes each game to its own record and reads it back', async () => {
    await saveGame(freeGame());
    await saveDailyGame(dailyGame('2026-09-07'));
    expect([...store.keys()].sort()).toEqual([DAILY_KEY, FREE_KEY]);
    expect((await loadGame())!.mode).toBe('free');
    expect((await loadDailyGame())!.dailyKey).toBe('2026-09-07');
    await clearDailyGame();
    expect(store.has(DAILY_KEY)).toBe(false);
    expect(store.has(FREE_KEY)).toBe(true);
    expect(await loadDailyGame()).toBeNull();
    expect(await loadGame()).not.toBeNull();
  });

  it('reads the free record as a free game however the save is labelled', async () => {
    // The daily slot is the only one checked for staleness, so a daily-mode
    // save read out of the free record is played as a daily for whatever date
    // it names: seven of them mint seven daily results, a streak and badges.
    // Which game a save is comes from the record it was in, so this can only
    // go wrong if the two ever get paired the other way round.
    store.set(FREE_KEY, JSON.stringify({ ...dailyGame('2026-09-05'), settings: { ...DEFAULT_SETTINGS, difficulty: 'expert' } }));
    const restored = (await loadGame())!;
    expect(restored.mode).toBe('free');
    expect(restored.dailyKey).toBeNull();
  });

  it('reads the daily record as a daily, and refuses one with no day', async () => {
    store.set(DAILY_KEY, JSON.stringify(freeGame()));
    // A free-game save has no dailyKey, so there is no daily in that record.
    expect(await loadDailyGame()).toBeNull();
    // And a real daily keeps its day, and its day's rules.
    store.set(DAILY_KEY, JSON.stringify({
      ...dailyGame('2026-09-07'),
      settings: { ...dailySettings(DEFAULT_SETTINGS, dailyConfig('2026-09-07')), difficulty: 'expert' },
    }));
    const daily = (await loadDailyGame())!;
    expect(daily.mode).toBe('daily');
    expect(daily.dailyKey).toBe('2026-09-07');
    expect(daily.settings.difficulty).toBe(dailyConfig('2026-09-07').difficulty);
  });

  it('keeps the two games apart', async () => {
    await saveGame(freeGame());
    expect(await loadDailyGame()).toBeNull();
    await saveDailyGame(dailyGame('2026-09-07'));
    expect((await loadGame())!.mode).toBe('free');
    expect(JSON.parse(store.get(FREE_KEY)!).dailyKey).toBeNull();
    expect(JSON.parse(store.get(DAILY_KEY)!).dailyKey).toBe('2026-09-07');
  });

  it('survives a record that is not a game at all', async () => {
    store.set(FREE_KEY, 'not json');
    expect(await loadGame()).toBeNull();
    store.set(DAILY_KEY, JSON.stringify({ hello: 'world' }));
    expect(await loadDailyGame()).toBeNull();
    store.delete(FREE_KEY);
    expect(await loadGame()).toBeNull();
  });

  it('still reads the records older releases wrote', async () => {
    // The first release wrapped the state, and several fields have been added
    // to a game since. A player who has not opened the app in a year still
    // has one of these on disk, and it has to come back as a game.
    const { history, notes, phantoms, elapsed, ...older } = freeGame();
    store.set(FREE_KEY, JSON.stringify({ state: older, elapsed: 42 }));
    const restored = (await loadGame())!;
    expect(restored.elapsed).toBe(42);
    expect(restored.mode).toBe('free');
    expect(restored.notes).toHaveLength(81);
    expect(restored.phantoms).toHaveLength(81);
    expect(restored.history).toEqual([]);
  });
});

describe('the shared settings record', () => {
  const SETTINGS_KEY = 'sudokuoku:settings:v1';
  const HELP_SEEN_KEY = 'sudokuoku:helpSeen:v1';
  const shared = { theme: 'dark', shiftPreview: 'exact' };

  it('is the key table, spelled out', () => {
    expect(KEYS.settings).toBe(SETTINGS_KEY);
    expect(LEGACY_KEYS.helpSeen).toBe(HELP_SEEN_KEY);
  });

  it('folds the old help-seen flag into the record and removes the old key', async () => {
    // Old only: the record does not exist yet.
    store.set(HELP_SEEN_KEY, '1');
    expect(await loadSharedSettings()).toEqual({ settings: {}, seenIntro: true });
    expect(JSON.parse(store.get(SETTINGS_KEY)!)).toEqual({ seenIntro: true });
    expect(store.has(HELP_SEEN_KEY)).toBe(false);
  });

  it('keeps the settings already in the record while folding the flag in', async () => {
    store.set(SETTINGS_KEY, JSON.stringify(shared));
    store.set(HELP_SEEN_KEY, '1');
    expect(await loadSharedSettings()).toEqual({ settings: shared, seenIntro: true });
    // Bytes are copied, not judged: the record keeps whatever it held.
    expect(JSON.parse(store.get(SETTINGS_KEY)!)).toEqual({ ...shared, seenIntro: true });
    expect(store.has(HELP_SEEN_KEY)).toBe(false);
  });

  it('reads a record that already carries the flag, and nothing else', async () => {
    // New only.
    store.set(SETTINGS_KEY, JSON.stringify({ ...shared, seenIntro: true }));
    expect(await loadSharedSettings()).toEqual({ settings: shared, seenIntro: true });
    expect([...store.keys()]).toEqual([SETTINGS_KEY]);
    // A record with the flag unset is one the player has not read the intro through.
    store.set(SETTINGS_KEY, JSON.stringify({ ...shared, seenIntro: false }));
    expect((await loadSharedSettings()).seenIntro).toBe(false);
  });

  it('lets the record win when both exist, and drops the old key', async () => {
    // Both present can only mean a migrated build could not delete the old
    // key: the record is what that build has read and written since.
    store.set(SETTINGS_KEY, JSON.stringify({ ...shared, seenIntro: false }));
    store.set(HELP_SEEN_KEY, '1');
    expect((await loadSharedSettings()).seenIntro).toBe(false);
    expect(store.has(HELP_SEEN_KEY)).toBe(false);
    expect(JSON.parse(store.get(SETTINGS_KEY)!)).toEqual({ ...shared, seenIntro: false });
  });

  it('leaves the old key in place when the record cannot be written', async () => {
    store.set(SETTINGS_KEY, JSON.stringify(shared));
    store.set(HELP_SEEN_KEY, '1');
    fault.writes = true;
    // The flag is still answered from the old key this launch...
    expect(await loadSharedSettings()).toEqual({ settings: shared, seenIntro: true });
    expect(store.has(HELP_SEEN_KEY)).toBe(true);
    expect(JSON.parse(store.get(SETTINGS_KEY)!)).toEqual(shared);
    // ...and the fold happens on the next launch that can write.
    fault.writes = false;
    expect(await loadSharedSettings()).toEqual({ settings: shared, seenIntro: true });
    expect(store.has(HELP_SEEN_KEY)).toBe(false);
    expect(JSON.parse(store.get(SETTINGS_KEY)!)).toEqual({ ...shared, seenIntro: true });
  });

  it('does not overwrite a record it cannot read', async () => {
    // Not JSON: still the player's only copy of it. The flag is read from the
    // old key, which stays until the app's own next write repairs the record.
    store.set(SETTINGS_KEY, '{not json');
    store.set(HELP_SEEN_KEY, '1');
    expect(await loadSharedSettings()).toEqual({ settings: {}, seenIntro: true });
    expect(store.get(SETTINGS_KEY)).toBe('{not json');
    expect(store.has(HELP_SEEN_KEY)).toBe(true);
  });

  it('runs twice without changing anything the second time', async () => {
    store.set(SETTINGS_KEY, JSON.stringify(shared));
    store.set(HELP_SEEN_KEY, '1');
    const first = await loadSharedSettings();
    const snapshot = new Map(store);
    const second = await loadSharedSettings();
    expect(second).toEqual(first);
    expect(store).toEqual(snapshot);
  });

  it('does not nag on every launch when there is no store at all', async () => {
    fault.all = true;
    expect(await loadSharedSettings()).toEqual({ settings: {}, seenIntro: true });
    // ...and a store with nothing in it shows the intro once.
    fault.all = false;
    expect(await loadSharedSettings()).toEqual({ settings: {}, seenIntro: false });
  });

  it('is the only record a settings write touches, and carries the flag', async () => {
    await saveGame(freeGame());
    await saveDailyGame(dailyGame('2026-09-07'));
    store.set(KEYS.profile, JSON.stringify({ xp: 10 }));
    const before = new Map(store);
    await saveSharedSettings({ settings: { theme: 'dark' }, seenIntro: true });
    for (const [key, value] of before) expect(store.get(key), key).toBe(value);
    expect(JSON.parse(store.get(SETTINGS_KEY)!)).toEqual({ theme: 'dark', seenIntro: true });
    expect(await loadSharedSettings()).toEqual({ settings: { theme: 'dark' }, seenIntro: true });
  });
});
