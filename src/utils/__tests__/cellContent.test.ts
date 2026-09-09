import { describe, expect, it } from 'vitest';
import {
  Action,
  DEFAULT_SETTINGS,
  GameState,
  Settings,
  isLocked,
  newGame,
  reduce,
} from '../../engine';
import { cellContent } from '../cellContent';
import { describeCell } from '../describe';

const PHANTOM: Settings = {
  ...DEFAULT_SETTINGS,
  enabledShifts: [],
  phantomMode: true,
  phantomEvery: 1,
  phantomLockMoves: 2,
  phantomFadeMs: 1000,
};

const run = (state: GameState, ...actions: Action[]) => actions.reduce(reduce, state);

/** Fills the first empty, unlocked cell with its solution digit. */
function playCorrect(state: GameState): GameState {
  const q = state.values.findIndex((v, i) => v === 0 && !isLocked(state, i));
  return run(state, { type: 'select', pos: q }, { type: 'input', digit: state.solution[q], now: 1000 });
}

/** A game with one faded cell, still locked. */
function lockedPhantom(settings: Settings = PHANTOM): { state: GameState; pos: number } {
  const state = playCorrect(newGame(settings, 91));
  const pos = state.phantoms.findIndex((ph) => ph !== null);
  expect(pos).toBeGreaterThanOrEqual(0);
  expect(isLocked(state, pos)).toBe(true);
  return { state, pos };
}

describe('cellContent', () => {
  it('draws the faded digit and its marker while the cell is locked', () => {
    const { state, pos } = lockedPhantom();
    const c = cellContent(state, pos);
    expect(c.phantom!.value).toBe(state.phantoms[pos]!.value);
    expect(c.marker).toBe(true);
    expect(c.value).toBe(0);
    expect(c.notes).toBe(0);
  });

  it('draws no marker when the player has turned markers off', () => {
    const { state, pos } = lockedPhantom({ ...PHANTOM, phantomMarkers: false });
    expect(cellContent(state, pos).marker).toBe(false);
  });

  it('draws pencil marks written into a phantom cell once its lock expires', () => {
    let { state, pos } = lockedPhantom();
    while (isLocked(state, pos)) state = playCorrect(state);
    // The record lingers, unlocked, so the recall can still be scored.
    expect(state.phantoms[pos]).not.toBeNull();
    expect(state.values[pos]).toBe(0);

    const noted = run(
      state,
      { type: 'select', pos },
      { type: 'toggleNotesMode' },
      { type: 'input', digit: 3 },
      { type: 'input', digit: 7 },
    );
    const c = cellContent(noted, pos);
    expect(c.notes).toBe((1 << 3) | (1 << 7));
    expect(c.marker).toBe(false);
    expect(c.value).toBe(0);
    // What the board draws and what a screen reader reads out agree.
    expect(describeCell(noted, pos)).toContain('noted 3 and 7');
  });

  it('drops the marker when every phantom is unlocked early to keep the game playable', () => {
    const { state, pos } = lockedPhantom();
    const freed: GameState = {
      ...state,
      phantoms: state.phantoms.map((ph) => (ph === null ? null : { ...ph, unlocked: true })),
    };
    expect(freed.moves).toBeLessThan(freed.phantoms[pos]!.unlockAtMove);
    expect(cellContent(freed, pos).marker).toBe(false);
    expect(describeCell(freed, pos)).toContain('empty');
  });

  it('draws a digit rather than the pencil marks it replaced', () => {
    const s = newGame({ ...DEFAULT_SETTINGS, enabledShifts: [] }, 92);
    const p = s.values.findIndex((v, i) => v === 0 && !s.given[i]);
    const noted = run(s, { type: 'select', pos: p }, { type: 'toggleNotesMode' }, { type: 'input', digit: 5 });
    expect(cellContent(noted, p).notes).toBe(1 << 5);
    const filled = run(noted, { type: 'toggleNotesMode' }, { type: 'input', digit: 4 });
    const c = cellContent(filled, p);
    expect(c.value).toBe(4);
    expect(c.notes).toBe(0);
  });
});
