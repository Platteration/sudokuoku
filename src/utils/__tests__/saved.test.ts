import { describe, expect, it } from 'vitest';
import {
  CELLS,
  DEFAULT_SETTINGS,
  GameState,
  RULE_KEYS,
  Settings,
  dailyConfig,
  dailySeed,
  dailySettings,
  emptyProfile,
  isLocked,
  newGame,
  recordGameWin,
  reduce,
  xpForWin,
} from '../../engine';
import {
  PERSISTED_HISTORY,
  SHARED_SETTING_KEYS,
  applyShared,
  cleanSettings,
  forStorage,
  pickShared,
  readSavedGame,
} from '../saved';

/**
 * A board one cell short of complete, written by hand the way an edited save
 * is: the next digit wins the game.
 */
function almostWon(seed: number, over: Record<string, unknown>): unknown {
  const s = newGame(DEFAULT_SETTINGS, seed);
  const values = s.solution.slice();
  values[0] = 0;
  return JSON.parse(
    JSON.stringify({ ...s, values, given: new Array(CELLS).fill(false), selected: 0, ...over }),
  );
}

/** Exactly what storage does: stringify on the way out, parse on the way in. */
const roundTrip = (state: GameState): GameState | null =>
  readSavedGame(JSON.parse(JSON.stringify(forStorage(state))), 'free');

/**
 * Plays `moves` moves without ever finishing the board: a digit goes in and
 * comes straight back out, so the history grows past its cap.
 */
function play(settings: Settings, seed: number, moves: number): GameState {
  let s: GameState = newGame(settings, seed);
  for (let i = 0; i < moves; i++) {
    const q = s.values.findIndex((v, idx) => v === 0 && !isLocked(s, idx));
    if (q < 0) break;
    s = reduce(s, { type: 'select', pos: q });
    s = reduce(s, { type: 'input', digit: (i % 9) + 1, now: 1000 });
    s = reduce(s, { type: 'erase', now: 1000 });
  }
  return s;
}

const CHAOS: Settings = {
  ...DEFAULT_SETTINGS,
  shiftsPerMove: 2,
  phantomMode: true,
  phantomEvery: 2,
  phantomLockMoves: 8,
  phantomMax: 4,
};

describe('what a save costs', () => {
  it('stays small however long the game runs', () => {
    const s = play(CHAOS, 7, 200);
    expect(s.history.length).toBeGreaterThan(PERSISTED_HISTORY);
    const written = JSON.stringify(forStorage(s));
    // Two games are on disk at once and AsyncStorage reads them back through
    // Android's 2 MB CursorWindow, so a single game has to stay far below it.
    expect(written.length).toBeLessThan(200_000);
    // And the history is what would eat that room: without the trim this save
    // is several times the size.
    expect(JSON.stringify(s).length).toBeGreaterThan(4 * written.length);
  });

  it('keeps an undo depth worth having after a restart', () => {
    const s = play(CHAOS, 8, 60);
    const restored = roundTrip(s)!;
    expect(restored.history).toHaveLength(PERSISTED_HISTORY);
    // The most recent move is the one a player comes back and undoes.
    const undone = reduce(restored, { type: 'undo' });
    expect(undone.values).toEqual(s.history[s.history.length - 1].values);
    expect(undone.tokens).toEqual(s.history[s.history.length - 1].tokens);
  });
});

describe('reading a save back', () => {
  it('restores a real game unchanged', () => {
    const s = play(CHAOS, 9, 5);
    expect(roundTrip(s)).toEqual(s);
  });

  it('reads the older { state, elapsed } wrapper', () => {
    const s = play(DEFAULT_SETTINGS, 10, 2);
    const legacy = JSON.parse(JSON.stringify({ state: { ...s, elapsed: undefined }, elapsed: 42 }));
    expect(readSavedGame(legacy, 'free')!.elapsed).toBe(42);
  });

  it('refuses anything that is not a board', () => {
    const s = play(DEFAULT_SETTINGS, 11, 2);
    expect(readSavedGame(null, 'free')).toBeNull();
    expect(readSavedGame('a string', 'free')).toBeNull();
    expect(readSavedGame({}, 'free')).toBeNull();
    expect(readSavedGame({ ...s, values: s.values.slice(0, 80) }, 'free')).toBeNull();
    expect(readSavedGame({ ...s, solution: s.solution.slice(0, 40) }, 'free')).toBeNull();
    expect(readSavedGame({ ...s, given: s.given.slice(0, 3) }, 'free')).toBeNull();
    expect(readSavedGame({ ...s, values: s.values.map(() => 'x') }, 'free')).toBeNull();
  });

  it('refuses tokens that are not a permutation of the cells', () => {
    // The board indexes an animated position per token, so a token id outside
    // the board, or one cell holding two of them, throws while rendering.
    const s = play(DEFAULT_SETTINGS, 12, 2);
    const duplicated = s.tokens.slice();
    duplicated[0] = duplicated[1];
    expect(readSavedGame({ ...s, tokens: duplicated }, 'free')).toBeNull();
    const outOfRange = s.tokens.slice();
    outOfRange[0] = CELLS + 5;
    expect(readSavedGame({ ...s, tokens: outOfRange }, 'free')).toBeNull();
    expect(readSavedGame({ ...s, tokens: s.tokens.map(() => 0) }, 'free')).toBeNull();
  });

  it('drops a shift event the board could not draw', () => {
    const s = play(DEFAULT_SETTINGS, 13, 2);
    expect(s.lastShift).not.toBeNull();
    expect(readSavedGame({ ...s, lastShift: { ...s.lastShift, dest: 'nope' } }, 'free')!.lastShift).toBeNull();
    expect(readSavedGame({ ...s, lastShift: { ...s.lastShift, kind: 'wobble' } }, 'free')!.lastShift).toBeNull();
    expect(readSavedGame({ ...s, lastShift: s.lastShift }, 'free')!.lastShift).toEqual(s.lastShift);
  });

  it('repairs what it can rather than dropping the game', () => {
    const s = play(DEFAULT_SETTINGS, 14, 2);
    const patched = readSavedGame({
      ...s,
      notes: undefined,
      selected: 900,
      elapsed: 'soon',
      status: 'quantum',
      phantoms: [{ nonsense: true }],
      lastPhantom: 7,
      history: [...s.history, { values: 3 }],
    }, 'free')!;
    expect(patched.notes).toEqual(new Array(CELLS).fill(0));
    expect(patched.selected).toBeNull();
    expect(patched.elapsed).toBe(0);
    expect(patched.status).toBe('playing');
    expect(patched.phantoms).toHaveLength(CELLS);
    expect(patched.phantoms.every((ph) => ph === null)).toBe(true);
    expect(patched.lastPhantom).toBeNull();
    expect(patched.history).toHaveLength(s.history.length);
    // Still a playable game: a move works and shifts the board.
    const q = patched.values.findIndex((v) => v === 0);
    const moved = reduce(reduce(patched, { type: 'select', pos: q }), { type: 'input', digit: 1 });
    expect(moved.moves).toBe(patched.moves + 1);
  });
});

describe('settings from a save', () => {
  it('keeps only shift kinds the game knows', () => {
    // A stray value here makes randomShift return undefined and the first
    // move of the restored game throw.
    expect(cleanSettings({ enabledShifts: ['rotate', 'wobble', 42] }).enabledShifts).toEqual([
      'rotate',
    ]);
    expect(cleanSettings({ enabledShifts: 'all' }).enabledShifts).toEqual(
      DEFAULT_SETTINGS.enabledShifts,
    );
    expect(cleanSettings({ enabledShifts: [] }).enabledShifts).toEqual([]);
  });

  it('falls back for missing, mistyped and unknown values', () => {
    const cleaned = cleanSettings({
      theme: 'ultraviolet',
      difficulty: 'impossible',
      phantomTarget: 7,
      phantomEvery: '3',
      phantomFadeMs: Number.NaN,
      highlightConflicts: 'yes',
    });
    expect(cleaned.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(cleaned.difficulty).toBe(DEFAULT_SETTINGS.difficulty);
    expect(cleaned.phantomTarget).toBe(DEFAULT_SETTINGS.phantomTarget);
    expect(cleaned.phantomEvery).toBe(DEFAULT_SETTINGS.phantomEvery);
    expect(cleaned.phantomFadeMs).toBe(DEFAULT_SETTINGS.phantomFadeMs);
    expect(cleaned.highlightConflicts).toBe(DEFAULT_SETTINGS.highlightConflicts);
    expect(cleanSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the choices the player really made', () => {
    const mine: Settings = {
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      difficulty: 'expert',
      shiftPreview: 'exact',
      phantomTarget: 'givens',
      phantomFadeMs: 1500,
      themePack: 'terminal',
      showMistakes: true,
    };
    expect(cleanSettings(mine)).toEqual(mine);
  });
});

describe('shared settings', () => {
  it('are appearance and assistance, never what the puzzle is', () => {
    const shared = pickShared(DEFAULT_SETTINGS);
    expect(Object.keys(shared).sort()).toEqual([...SHARED_SETTING_KEYS].sort());
    // phantomMarkers is deliberately in both lists: a preset sets it, and it
    // also follows the player. Nothing else about the rules may travel, or
    // the daily would stop being the same puzzle for everyone.
    for (const rule of RULE_KEYS.filter((k) => k !== 'phantomMarkers')) {
      expect(Object.keys(shared)).not.toContain(rule);
    }
    expect(Object.keys(shared)).not.toContain('difficulty');
  });

  it('follow the player onto the other game and survive a restart', () => {
    // The change is made while the daily is on screen: the free game's own
    // copy of the settings is older, and must not win.
    const daily: Settings = { ...DEFAULT_SETTINGS, theme: 'dark', shiftPreview: 'exact' };
    const stored = JSON.parse(JSON.stringify(pickShared(daily)));
    const free: Settings = { ...DEFAULT_SETTINGS, difficulty: 'expert', phantomMode: true };
    const restored = applyShared(free, stored);
    expect(restored.theme).toBe('dark');
    expect(restored.shiftPreview).toBe('exact');
    // The free game keeps its own rules.
    expect(restored.difficulty).toBe('expert');
    expect(restored.phantomMode).toBe(true);
  });

  it('ignore a blob that carries rules or junk', () => {
    const free: Settings = { ...DEFAULT_SETTINGS, difficulty: 'hard' };
    expect(
      applyShared(free, { difficulty: 'easy', phantomMode: true, theme: 'nonsense', showMistakes: 1 }),
    ).toEqual(free);
    expect(applyShared(free, null)).toEqual(free);
    expect(applyShared(free, 'nope')).toEqual(free);
  });
});

describe('a save that was edited', () => {
  const hostile = (over: Record<string, unknown>): unknown =>
    JSON.parse(JSON.stringify({ ...play(DEFAULT_SETTINGS, 20, 2), ...over }));

  it('cannot pass a daily off as the free game', () => {
    // Only the daily slot is checked for staleness, so a daily-mode game
    // restored into the free one is played as a daily for whatever date it
    // names. Which game a save is comes from the slot, not from the save.
    const restored = readSavedGame(hostile({ mode: 'daily', dailyKey: '2026-09-05' }), 'free')!;
    expect(restored.mode).toBe('free');
    expect(restored.dailyKey).toBeNull();
  });

  it('cannot mint a daily result by finishing one in the free slot', () => {
    const raw = almostWon(21, { mode: 'daily', dailyKey: '2026-09-05', status: 'playing' });
    const restored = readSavedGame(raw, 'free')!;
    const won = reduce(restored, { type: 'input', digit: restored.solution[0] });
    expect(won.status).toBe('won');
    const out = recordGameWin(emptyProfile(), won, new Date(2026, 8, 11));
    expect(out.profile.daily).toEqual({});
    expect(out.profile.totals.dailiesCompleted).toBe(0);
    expect(out.streak).toBe(0);
    expect(out.newBadges.map((b) => b.id)).not.toContain('daily-first');
    // The win still counts as a win: it is only not a daily.
    expect(out.profile.totals.won).toBe(1);
  });

  it('refuses a daily whose day is not a date', () => {
    // A daily is filed under its day and its rules are rebuilt from it, so a
    // key that is not a day leaves a daily with nothing to be: 'NaN-NaN-NaN'
    // is its own previous day, which is what used to walk the streak for ever.
    expect(readSavedGame(almostWon(22, { dailyKey: 'NaN-NaN-NaN' }), 'daily')).toBeNull();
    expect(readSavedGame(almostWon(22, { dailyKey: '2026-9-6' }), 'daily')).toBeNull();
    expect(readSavedGame(almostWon(22, { dailyKey: 42 }), 'daily')).toBeNull();
    expect(readSavedGame(almostWon(22, { dailyKey: null }), 'daily')).toBeNull();
    expect(readSavedGame(almostWon(22, { dailyKey: '2026-09-05' }), 'daily')!.dailyKey).toBe(
      '2026-09-05',
    );
  });

  it('plays a restored daily by its own day\u2019s rules, not the save\u2019s', () => {
    const key = '2026-09-07'; // Monday: easy, no phantoms
    const real = newGame(dailySettings(DEFAULT_SETTINGS, dailyConfig(key)), dailySeed(key), {
      mode: 'daily',
      dailyKey: key,
    });
    const raw = JSON.parse(
      JSON.stringify({
        ...real,
        settings: { ...real.settings, difficulty: 'expert', phantomMode: true, shiftEvery: 9, theme: 'dark' },
      }),
    );
    const restored = readSavedGame(raw, 'daily')!;
    // The rules are a function of the day, so they come back as the app built
    // them; a save claiming expert would otherwise buy the expert XP.
    expect(restored.settings.difficulty).toBe(real.settings.difficulty);
    expect(restored.settings.difficulty).not.toBe('expert');
    expect(restored.settings.phantomMode).toBe(real.settings.phantomMode);
    expect(restored.settings.shiftEvery).toBe(real.settings.shiftEvery);
    // The player's own assists are still the player's.
    expect(restored.settings.theme).toBe('dark');
  });

  it('counts cannot come back negative', () => {
    // XP, the clean-win test and the best times are read straight off these:
    // -100 hints is 1,500 XP and a clean win at any difficulty.
    const restored = readSavedGame(
      hostile({ hintsUsed: -100, moves: -5, elapsed: -3600, shiftCount: 2.7, phantomsRecalled: -9 }),
      'free',
    )!;
    expect(restored.hintsUsed).toBe(0);
    expect(restored.moves).toBe(0);
    expect(restored.elapsed).toBe(0);
    expect(restored.shiftCount).toBe(2);
    expect(restored.phantomsRecalled).toBe(0);
    // Worth exactly a clean win of that difficulty plus its two shifts.
    expect(xpForWin(restored)).toBe(xpForWin(newGame(restored.settings, 1)) + 2);
  });
});
