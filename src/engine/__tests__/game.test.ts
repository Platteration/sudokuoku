import { describe, expect, it } from 'vitest';
import {
  Action,
  DEFAULT_SETTINGS,
  GameState,
  applyShift,
  isLocked,
  mistakes,
  newGame,
  nextShift,
  reduce,
  remainingCounts,
} from '../game';
import { PRESETS, RULE_KEYS } from '../presets';
import { dailyConfig, dailySeed, dailySettings } from '../progress';
import { CELLS, isComplete } from '../sudoku';
import { rotateShift } from '../transforms';

const run = (state: GameState, ...actions: Action[]) =>
  actions.reduce(reduce, state);

function firstEmpty(state: GameState): number {
  return state.values.findIndex((v) => v === 0);
}

/** Every given, and every correct entry, should still match the solution. */
function expectConsistent(state: GameState) {
  for (let p = 0; p < CELLS; p++) {
    if (state.given[p]) expect(state.values[p]).toBe(state.solution[p]);
  }
  expect(isComplete(state.solution)).toBe(true);
  expect(new Set(state.tokens).size).toBe(CELLS);
}

describe('newGame', () => {
  it('starts with givens equal to the solution and no shift yet', () => {
    const s = newGame(DEFAULT_SETTINGS, 1);
    expectConsistent(s);
    expect(s.moves).toBe(0);
    expect(s.lastShift).toBeNull();
    expect(s.status).toBe('playing');
  });
});

describe('moves and shifts', () => {
  it('placing a digit counts as a move and fires a shift', () => {
    const s0 = newGame(DEFAULT_SETTINGS, 2);
    const p = firstEmpty(s0);
    const s1 = run(s0, { type: 'select', pos: p }, { type: 'input', digit: 4 });
    expect(s1.moves).toBe(1);
    expect(s1.shiftCount).toBe(1);
    expect(s1.lastShift).not.toBeNull();
    expectConsistent(s1);
  });

  it('the entered digit travels with its cell and the selection follows it', () => {
    const s0 = newGame(DEFAULT_SETTINGS, 2);
    const p = firstEmpty(s0);
    const token = s0.tokens[p];
    const s1 = run(s0, { type: 'select', pos: p }, { type: 'input', digit: 4 });
    const newPos = s1.tokens.indexOf(token);
    expect(s1.values[newPos]).toBe(4);
    expect(s1.selected).toBe(newPos);
    expect(s1.lastShift!.dest[p]).toBe(newPos);
  });

  it('a correct entry stays correct after any number of shifts', () => {
    const s0 = newGame(DEFAULT_SETTINGS, 3);
    const p = firstEmpty(s0);
    const token = s0.tokens[p];
    let s = run(s0, { type: 'select', pos: p }, { type: 'input', digit: s0.solution[p] });
    for (let i = 0; i < 20; i++) {
      const q = s.values.findIndex((v, idx) => v === 0 && !s.given[idx]);
      s = run(s, { type: 'select', pos: q }, { type: 'input', digit: s.solution[q] });
      const where = s.tokens.indexOf(token);
      expect(s.values[where]).toBe(s.solution[where]);
      expect(mistakes(s).size).toBe(0);
      expectConsistent(s);
    }
    expect(s.shiftCount).toBe(21);
  });

  it('honours shiftEvery', () => {
    const s0 = newGame({ ...DEFAULT_SETTINGS, shiftEvery: 3 }, 4);
    let s = s0;
    for (let i = 0; i < 6; i++) {
      const q = firstEmpty(s);
      s = run(s, { type: 'select', pos: q }, { type: 'input', digit: 1 + (i % 9) });
    }
    expect(s.moves).toBe(6);
    expect(s.shiftCount).toBe(2);
  });

  it('does not shift when no kinds are enabled', () => {
    const s0 = newGame({ ...DEFAULT_SETTINGS, enabledShifts: [] }, 5);
    const p = firstEmpty(s0);
    const s1 = run(s0, { type: 'select', pos: p }, { type: 'input', digit: 2 });
    expect(s1.moves).toBe(1);
    expect(s1.shiftCount).toBe(0);
    expect(s1.tokens).toEqual(s0.tokens);
  });

  it('notes do not count as moves and move with their cell', () => {
    const s0 = newGame(DEFAULT_SETTINGS, 6);
    const p = firstEmpty(s0);
    const token = s0.tokens[p];
    const s1 = run(
      s0,
      { type: 'select', pos: p },
      { type: 'toggleNotesMode' },
      { type: 'input', digit: 7 },
      { type: 'input', digit: 2 },
    );
    expect(s1.moves).toBe(0);
    expect(s1.notes[p]).toBe((1 << 7) | (1 << 2));
    const s2 = applyShift(s1, rotateShift(1));
    expect(s2.notes[s2.tokens.indexOf(token)]).toBe((1 << 7) | (1 << 2));
  });

  it('cannot change a given cell', () => {
    const s0 = newGame(DEFAULT_SETTINGS, 6);
    const g = s0.given.indexOf(true);
    const s1 = run(s0, { type: 'select', pos: g }, { type: 'input', digit: 9 }, { type: 'erase' });
    expect(s1.values).toEqual(s0.values);
    expect(s1.moves).toBe(0);
  });

  it('erase removes a value and counts as a move', () => {
    const s0 = newGame({ ...DEFAULT_SETTINGS, enabledShifts: [] }, 6);
    const p = firstEmpty(s0);
    const s1 = run(s0, { type: 'select', pos: p }, { type: 'input', digit: 3 }, { type: 'erase' });
    expect(s1.values[p]).toBe(0);
    expect(s1.moves).toBe(2);
  });
});

describe('undo', () => {
  it('restores the board, its orientation and the selection', () => {
    const s0 = newGame(DEFAULT_SETTINGS, 8);
    const p = firstEmpty(s0);
    const s1 = run(s0, { type: 'select', pos: p }, { type: 'input', digit: 5 });
    const s2 = reduce(s1, { type: 'undo' });
    expect(s2.values).toEqual(s0.values);
    expect(s2.tokens).toEqual(s0.tokens);
    expect(s2.solution).toEqual(s0.solution);
    expect(s2.selected).toBe(p);
    expect(s2.moves).toBe(0);
    expect(s2.history).toHaveLength(0);
  });

  it('is a no-op with no history', () => {
    const s0 = newGame(DEFAULT_SETTINGS, 8);
    expect(reduce(s0, { type: 'undo' })).toBe(s0);
  });
});

describe('hint and win', () => {
  it('hint fills the solution digit for the selected cell', () => {
    const s0 = newGame(DEFAULT_SETTINGS, 9);
    const p = firstEmpty(s0);
    const token = s0.tokens[p];
    const s1 = run(s0, { type: 'select', pos: p }, { type: 'hint' });
    const where = s1.tokens.indexOf(token);
    expect(s1.values[where]).toBe(s1.solution[where]);
    expect(s1.hintsUsed).toBe(1);
  });

  it('the game is won when the last cell is filled correctly, with no final shift', () => {
    let s = newGame({ ...DEFAULT_SETTINGS, difficulty: 'easy' }, 10);
    while (s.status === 'playing') {
      const q = s.values.findIndex((v) => v === 0);
      s = run(s, { type: 'select', pos: q }, { type: 'input', digit: s.solution[q] });
    }
    expect(s.status).toBe('won');
    expect(s.values).toEqual(s.solution);
    expect(s.shiftCount).toBe(s.moves - 1);
    expect(s.selected).toBeNull();
    // input after winning is ignored
    expect(reduce(s, { type: 'input', digit: 1 })).toBe(s);
  });

  it('tracks remaining counts per digit', () => {
    const s0 = newGame(DEFAULT_SETTINGS, 9);
    const counts = remainingCounts(s0);
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(s0.values.filter((v) => v === 0).length);
  });
});

describe('shift preview', () => {
  it('predicts exactly the shift the next move will apply', () => {
    let s = newGame(DEFAULT_SETTINGS, 31);
    for (let i = 0; i < 12; i++) {
      const predicted = nextShift(s);
      const q = s.values.findIndex((v, idx) => v === 0 && !s.given[idx]);
      const after = run(s, { type: 'select', pos: q }, { type: 'input', digit: s.solution[q] });
      expect(after.lastShift!.kind).toBe(predicted!.kind);
      expect(after.lastShift!.description).toBe(predicted!.description);
      expect(after.lastShift!.dest).toEqual(predicted!.dest);
      s = after;
    }
  });

  it('is null when the next move does not trigger a shift', () => {
    const s = newGame({ ...DEFAULT_SETTINGS, shiftEvery: 3 }, 32);
    expect(nextShift(s)).toBeNull(); // move 1 of 3
    const p = s.values.findIndex((v) => v === 0);
    const s1 = run(s, { type: 'select', pos: p }, { type: 'input', digit: 1 });
    expect(nextShift(s1)).toBeNull(); // move 2 of 3
    const q = s1.values.findIndex((v) => v === 0);
    const s2 = run(s1, { type: 'select', pos: q }, { type: 'input', digit: 1 });
    expect(nextShift(s2)).not.toBeNull(); // move 3 triggers
    expect(s2.shiftCount).toBe(0);
  });

  it('is null with no shifts enabled or once the game is over', () => {
    expect(nextShift(newGame({ ...DEFAULT_SETTINGS, enabledShifts: [] }, 33))).toBeNull();
    const won = { ...newGame(DEFAULT_SETTINGS, 33), status: 'won' as const };
    expect(nextShift(won)).toBeNull();
  });

  it('does not change when the player only takes notes', () => {
    const s = newGame(DEFAULT_SETTINGS, 34);
    const before = nextShift(s);
    const p = s.values.findIndex((v) => v === 0);
    const noted = run(s, { type: 'select', pos: p }, { type: 'toggleNotesMode' }, { type: 'input', digit: 5 });
    expect(nextShift(noted)!.description).toBe(before!.description);
  });
});

describe('updateSettings', () => {
  const zen = PRESETS.find((p) => p.id === 'zen')!;
  const dailyKey = '2026-09-09'; // a Wednesday: medium, phantom day
  const startDaily = (): GameState =>
    newGame(dailySettings(DEFAULT_SETTINGS, dailyConfig(dailyKey)), dailySeed(dailyKey), {
      mode: 'daily',
      dailyKey,
    });

  it('applies a preset in free play', () => {
    const s = newGame({ ...DEFAULT_SETTINGS, phantomMode: true }, 40);
    const after = reduce(s, { type: 'updateSettings', settings: zen.rules });
    expect(after.settings.enabledShifts).toEqual([]);
    expect(after.settings.phantomMode).toBe(false);
  });

  it('ignores rule changes during a daily but keeps appearance and assistance', () => {
    const s = startDaily();
    const after = reduce(s, {
      type: 'updateSettings',
      settings: { ...zen.rules, theme: 'dark', highlightConflicts: false, shiftPreview: 'exact' },
    });
    for (const key of RULE_KEYS) expect(after.settings[key]).toEqual(s.settings[key]);
    expect(after.settings.theme).toBe('dark');
    expect(after.settings.highlightConflicts).toBe(false);
    expect(after.settings.shiftPreview).toBe('exact');
  });

  it('keeps the daily shifting and fading after a preset tap', () => {
    let s = reduce(startDaily(), { type: 'updateSettings', settings: zen.rules });
    expect(s.settings.phantomMode).toBe(true);
    for (let i = 0; i < 6; i++) {
      const q = s.values.findIndex((v, idx) => v === 0 && !isLocked(s, idx));
      s = run(s, { type: 'select', pos: q }, { type: 'input', digit: s.solution[q] });
    }
    expect(s.shiftCount).toBeGreaterThan(0);
    expect(s.phantomCount).toBeGreaterThan(0);
  });
});
