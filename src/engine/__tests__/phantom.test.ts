import { describe, expect, it } from 'vitest';
import {
  Action,
  DEFAULT_SETTINGS,
  GameState,
  Settings,
  applyShift,
  isLocked,
  newGame,
  reduce,
} from '../game';
import { CELLS } from '../sudoku';
import { relabelShift, rotateShift } from '../transforms';

const PHANTOM: Settings = {
  ...DEFAULT_SETTINGS,
  enabledShifts: [],
  phantomMode: true,
  phantomTarget: 'both',
  phantomEvery: 2,
  phantomLockMoves: 3,
  phantomFadeMs: 1000,
};

const run = (state: GameState, ...actions: Action[]) => actions.reduce(reduce, state);

/** Fills the first empty, unlocked cell with its solution digit. */
function playCorrect(state: GameState, now = 1000): GameState {
  const q = state.values.findIndex((v, i) => v === 0 && !isLocked(state, i));
  return run(state, { type: 'select', pos: q }, { type: 'input', digit: state.solution[q], now });
}

function phantomPositions(state: GameState): number[] {
  return state.phantoms.map((ph, i) => (ph ? i : -1)).filter((i) => i >= 0);
}

describe('phantom creation', () => {
  it('does nothing when phantom mode is off', () => {
    let s = newGame({ ...PHANTOM, phantomMode: false }, 21);
    for (let i = 0; i < 6; i++) s = playCorrect(s);
    expect(s.phantomCount).toBe(0);
    expect(phantomPositions(s)).toEqual([]);
  });

  it('spawns a phantom every N moves and removes the digit from the board', () => {
    let s = newGame(PHANTOM, 21);
    s = playCorrect(s);
    expect(s.phantomCount).toBe(0);
    s = playCorrect(s, 5000);
    expect(s.phantomCount).toBe(1);
    const [pos] = phantomPositions(s);
    const ph = s.phantoms[pos]!;
    expect(s.values[pos]).toBe(0);
    expect(s.given[pos]).toBe(false);
    expect(ph.value).toBeGreaterThan(0);
    expect(ph.startedAt).toBe(5000);
    expect(ph.fadeMs).toBe(1000);
    expect(ph.createdAtMove).toBe(2);
    expect(ph.unlockAtMove).toBe(5);
    expect(s.lastPhantom).toBe(ph);
    expect(isLocked(s, pos)).toBe(true);
  });

  it('never fades the cell that was just changed', () => {
    for (let seed = 30; seed < 40; seed++) {
      let s = newGame({ ...PHANTOM, phantomEvery: 1, phantomTarget: 'entries' }, seed);
      const q = s.values.indexOf(0);
      s = run(s, { type: 'select', pos: q }, { type: 'input', digit: 5 });
      // The only entry on the board is the one just made, so nothing is eligible.
      expect(s.phantomCount).toBe(0);
      expect(s.values[q]).toBe(5);
    }
  });

  it('respects the target setting', () => {
    let entries = newGame({ ...PHANTOM, phantomTarget: 'entries', phantomEvery: 1 }, 22);
    entries = playCorrect(entries);
    entries = playCorrect(entries);
    for (const pos of phantomPositions(entries)) expect(entries.phantoms[pos]!.wasGiven).toBe(false);
    expect(entries.phantomCount).toBe(1);

    let givens = newGame({ ...PHANTOM, phantomTarget: 'givens', phantomEvery: 1 }, 22);
    givens = playCorrect(givens);
    for (const pos of phantomPositions(givens)) expect(givens.phantoms[pos]!.wasGiven).toBe(true);
    expect(givens.phantomCount).toBe(1);
  });

  it('is reproducible for a seed', () => {
    const a = playCorrect(playCorrect(newGame(PHANTOM, 23)));
    const b = playCorrect(playCorrect(newGame(PHANTOM, 23)));
    expect(phantomPositions(a)).toEqual(phantomPositions(b));
  });
});

describe('locked cells', () => {
  function withPhantom(): { s: GameState; pos: number } {
    let s = newGame(PHANTOM, 24);
    s = playCorrect(s);
    s = playCorrect(s);
    const [pos] = phantomPositions(s);
    return { s, pos };
  }

  it('reject values, notes, erase and hints while locked', () => {
    const { s, pos } = withPhantom();
    const sel = reduce(s, { type: 'select', pos });
    expect(reduce(sel, { type: 'input', digit: s.solution[pos] }).moves).toBe(s.moves);
    expect(reduce(sel, { type: 'hint' }).values[pos]).toBe(0);
    expect(reduce(sel, { type: 'erase' }).moves).toBe(s.moves);
    const notes = run(sel, { type: 'toggleNotesMode' }, { type: 'input', digit: 3 });
    expect(notes.notes[pos]).toBe(0);
  });

  it('unlock after the configured number of moves and can then be refilled', () => {
    let { s, pos } = withPhantom();
    const token = s.tokens[pos];
    expect(isLocked(s, pos)).toBe(true);
    s = playCorrect(s); // move 3
    s = playCorrect(s); // move 4 (a second phantom appears elsewhere)
    expect(isLocked(s, s.tokens.indexOf(token))).toBe(true);
    s = playCorrect(s); // move 5: unlock
    const where = s.tokens.indexOf(token);
    expect(isLocked(s, where)).toBe(false);
    expect(s.phantoms[where]).toBeNull();
    const refilled = run(s, { type: 'select', pos: where }, { type: 'input', digit: s.solution[where] });
    expect(refilled.values[where]).toBe(s.solution[where]);
    expect(refilled.moves).toBe(6);
  });

  it('a faded given can be refilled correctly and the game can still be won', () => {
    let s = newGame({ ...PHANTOM, difficulty: 'easy', phantomTarget: 'givens', phantomEvery: 4, phantomLockMoves: 2 }, 25);
    let guard = 0;
    while (s.status === 'playing' && guard++ < 500) s = playCorrect(s);
    expect(s.status).toBe('won');
    expect(s.values).toEqual(s.solution);
    expect(s.phantomCount).toBeGreaterThan(0);
  });
});

describe('phantoms and the rest of the game', () => {
  it('travel with shifts, and a digit shift relabels the fading value', () => {
    let s = newGame(PHANTOM, 26);
    s = playCorrect(s);
    s = playCorrect(s);
    const [pos] = phantomPositions(s);
    const token = s.tokens[pos];
    const value = s.phantoms[pos]!.value;
    const rotated = applyShift(s, rotateShift(1));
    const where = rotated.tokens.indexOf(token);
    expect(rotated.phantoms[where]).toEqual(s.phantoms[pos]);
    expect(isLocked(rotated, where)).toBe(true);
    const relabeled = applyShift(rotated, relabelShift(1));
    expect(relabeled.phantoms[where]!.value).toBe((value % 9) + 1);
    expect(relabeled.phantoms.filter(Boolean)).toHaveLength(1);
  });

  it('undo restores the faded digit and clears the lock', () => {
    let s = newGame(PHANTOM, 27);
    s = playCorrect(s);
    const before = s;
    s = playCorrect(s);
    const [pos] = phantomPositions(s);
    const back = reduce(s, { type: 'undo' });
    expect(back.values).toEqual(before.values);
    expect(back.given).toEqual(before.given);
    expect(back.phantoms).toEqual(before.phantoms);
    expect(back.phantomCount).toBe(0);
    expect(isLocked(back, pos)).toBe(false);
  });

  it('never leaves the player without a playable cell', () => {
    for (let seed = 40; seed < 46; seed++) {
      let s = newGame(
        { ...PHANTOM, difficulty: 'easy', phantomTarget: 'both', phantomEvery: 1, phantomLockMoves: 9 },
        seed,
      );
      let guard = 0;
      while (s.status === 'playing' && guard++ < 400) {
        const q = s.values.findIndex((v, i) => v === 0 && !isLocked(s, i));
        expect(q).toBeGreaterThanOrEqual(0);
        s = playCorrect(s);
      }
      expect(s.status).toBe('won');
    }
  });

  it('never holds more than phantomMax phantoms at once', () => {
    let s = newGame({ ...PHANTOM, phantomEvery: 1, phantomLockMoves: 50, phantomMax: 2 }, 28);
    for (let i = 0; i < 30; i++) {
      s = playCorrect(s);
      expect(phantomPositions(s).length).toBeLessThanOrEqual(2);
    }
    expect(s.phantoms).toHaveLength(CELLS);
    expect(s.phantomCount).toBe(2);
  });
});
