import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, GameState, newGame, reduce } from '../../engine';
import { describeCell, describeShift } from '../describe';

const base = (): GameState => newGame({ ...DEFAULT_SETTINGS, enabledShifts: [] }, 77);

describe('describeCell', () => {
  it('reads a given, an entry and an empty cell', () => {
    const s = base();
    const given = s.given.indexOf(true);
    expect(describeCell(s, given)).toMatch(/^Row \d, column \d, \d, given$/);

    const empty = s.values.findIndex((v, i) => v === 0 && !s.given[i]);
    expect(describeCell(s, empty)).toMatch(/^Row \d, column \d, empty$/);

    const filled = reduce(reduce(s, { type: 'select', pos: empty }), { type: 'input', digit: 4 });
    expect(describeCell(filled, empty)).toMatch(/^Row \d, column \d, 4$/);
    expect(describeCell(filled, empty)).not.toContain('given');
  });

  it('lists notes in plain words', () => {
    const s = base();
    const p = s.values.findIndex((v, i) => v === 0 && !s.given[i]);
    const one = reduce(
      reduce(reduce(s, { type: 'select', pos: p }), { type: 'toggleNotesMode' }),
      { type: 'input', digit: 5 },
    );
    expect(describeCell(one, p)).toContain('empty, noted 5');
    const three = [1, 7].reduce((acc, d) => reduce(acc, { type: 'input', digit: d }), one);
    expect(describeCell(three, p)).toContain('noted 1, 5 and 7');
  });

  it('reads a locked phantom with the moves remaining', () => {
    let s = newGame(
      { ...DEFAULT_SETTINGS, enabledShifts: [], phantomMode: true, phantomEvery: 1, phantomLockMoves: 4 },
      78,
    );
    const q = s.values.findIndex((v) => v === 0);
    s = reduce(reduce(s, { type: 'select', pos: q }), { type: 'input', digit: s.solution[q] });
    const locked = s.phantoms.findIndex((ph) => ph !== null);
    expect(locked).toBeGreaterThanOrEqual(0);
    expect(describeCell(s, locked)).toMatch(/faded and locked for \d more moves?$/);
  });
});

describe('describeShift', () => {
  it('says what moved and where the selection went', () => {
    expect(describeShift('Board rotated clockwise', 0)).toBe(
      'Board rotated clockwise. Your cell is now row 1, column 1.',
    );
    expect(describeShift('Every row shifted down 3', null)).toBe('Every row shifted down 3.');
  });
});
