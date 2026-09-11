import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, GameState, dailyConfig, dailySeed, dailySettings, newGame } from '../engine';

/**
 * AsyncStorage, in memory. The store is the point of these tests: which record
 * a game is written to and read back from is what decides how much of it is
 * believed, so the two have to be watched from outside the module.
 */
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  },
}));

const { clearDailyGame, loadDailyGame, loadGame, saveDailyGame, saveGame } = await import('../storage');

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

beforeEach(() => store.clear());

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
