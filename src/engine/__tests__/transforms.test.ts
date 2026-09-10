import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { CELLS, generatePuzzle, generateSolution, isComplete, solve } from '../sudoku';
import {
  ALL_SHIFT_KINDS,
  Shift,
  applyToGrid,
  applyToNotes,
  bandRowsShift,
  bandsShift,
  boxSlideShift,
  joinDescriptions,
  mirrorShift,
  permute,
  randomShift,
  randomShiftOfKind,
  relabelShift,
  rotateShift,
  stackColsShift,
  stacksShift,
} from '../transforms';

const solution = generateSolution(createRng(3));

function expectPermutation(shift: Shift) {
  expect(shift.dest).toHaveLength(CELLS);
  expect(new Set(shift.dest).size).toBe(CELLS);
  expect(shift.relabel.slice(1).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
}

function expectPreservesValidity(shift: Shift) {
  expectPermutation(shift);
  const moved = applyToGrid(solution, shift);
  expect(isComplete(moved)).toBe(true);
}

function isIdentity(shift: Shift): boolean {
  return (
    shift.dest.every((d, i) => d === i) && shift.relabel.every((d, i) => d === i)
  );
}

describe('individual shifts preserve validity', () => {
  it('band row cycles', () => {
    for (let band = 0; band < 3; band++)
      for (const k of [1, 2]) expectPreservesValidity(bandRowsShift(band, k));
  });
  it('stack column cycles', () => {
    for (let stack = 0; stack < 3; stack++)
      for (const k of [1, 2]) expectPreservesValidity(stackColsShift(stack, k));
  });
  it('band and stack cycles', () => {
    for (const k of [1, 2]) {
      expectPreservesValidity(bandsShift(k));
      expectPreservesValidity(stacksShift(k));
    }
  });
  it('rotations', () => {
    for (const q of [1, 2, 3]) expectPreservesValidity(rotateShift(q));
  });
  it('mirrors', () => {
    for (const axis of ['horizontal', 'vertical', 'diagonal', 'anti-diagonal'] as const)
      expectPreservesValidity(mirrorShift(axis));
  });
  it('box slides', () => {
    for (let dr = 0; dr < 3; dr++)
      for (let dc = 0; dc < 3; dc++)
        if (dr || dc) expectPreservesValidity(boxSlideShift(dr, dc));
  });
  it('relabels', () => {
    for (let k = 1; k <= 8; k++) expectPreservesValidity(relabelShift(k));
  });
});

describe('shift geometry', () => {
  it('rows 1-3 sliding down 1 moves row 1 to row 2 and row 3 to row 1', () => {
    const s = bandRowsShift(0, 1);
    expect(s.dest[0]).toBe(9);
    expect(s.dest[18]).toBe(0);
    expect(s.dest[27]).toBe(27); // other bands untouched
  });
  it('every row shifting down 3 wraps the last band to the top', () => {
    const s = bandsShift(1);
    expect(s.dest[0]).toBe(27);
    expect(s.dest[72]).toBe(18);
  });
  it('clockwise rotation moves the top-left corner to the top-right', () => {
    const s = rotateShift(1);
    expect(s.dest[0]).toBe(8);
    expect(s.dest[8]).toBe(80);
    expect(s.dest[40]).toBe(40);
  });
  it('four quarter turns return to the start', () => {
    let g = solution;
    for (let i = 0; i < 4; i++) g = applyToGrid(g, rotateShift(1));
    expect(g).toEqual(solution);
  });
  it('box slide keeps every cell inside its own box', () => {
    const s = boxSlideShift(1, 2);
    for (let p = 0; p < CELLS; p++) {
      const box = (q: number) => Math.floor(Math.floor(q / 9) / 3) * 3 + Math.floor((q % 9) / 3);
      expect(box(s.dest[p])).toBe(box(p));
    }
  });
  it('relabel wraps 9 to 1 and moves notes along', () => {
    const s = relabelShift(1);
    expect(s.relabel[9]).toBe(1);
    expect(s.relabel[1]).toBe(2);
    const notes = new Array(CELLS).fill(0);
    notes[5] = (1 << 9) | (1 << 3);
    const moved = applyToNotes(notes, s);
    expect(moved[5]).toBe((1 << 1) | (1 << 4));
  });
});

describe('random shifts', () => {
  it('never returns the identity, for every kind', () => {
    for (const kind of ALL_SHIFT_KINDS) {
      const rng = createRng(11);
      for (let i = 0; i < 200; i++) {
        const s = randomShiftOfKind(rng, kind);
        expect(s.kind).toBe(kind);
        expect(isIdentity(s)).toBe(false);
        expectPreservesValidity(s);
      }
    }
  });

  it('only picks from the enabled kinds and returns null with none enabled', () => {
    const rng = createRng(5);
    for (let i = 0; i < 100; i++) {
      const s = randomShift(rng, ['rotate', 'mirror']);
      expect(['rotate', 'mirror']).toContain(s!.kind);
    }
    expect(randomShift(rng, [])).toBeNull();
  });

  it('a long random sequence of shifts keeps a puzzle uniquely solvable', () => {
    const rng = createRng(99);
    let { clues, solution: sol } = generatePuzzle(rng, 'hard');
    for (let i = 0; i < 300; i++) {
      const s = randomShift(rng, ALL_SHIFT_KINDS)!;
      clues = applyToGrid(clues, s);
      sol = applyToGrid(sol, s);
      expect(isComplete(sol)).toBe(true);
    }
    expect(solve(clues)).toEqual(sol);
  });
});

describe('permute', () => {
  it('moves each item to dest[oldIndex]', () => {
    const s = stacksShift(1);
    const ids = Array.from({ length: CELLS }, (_, i) => i);
    const moved = permute(ids, s);
    for (let p = 0; p < CELLS; p++) expect(moved[s.dest[p]]).toBe(p);
  });
});

describe('describing a move', () => {
  it('reads several shifts of one move as one sentence', () => {
    // A move may fire up to four shifts; the banner and the screen reader get
    // one line, so it has to name all of them in the order they happened.
    expect(
      joinDescriptions([rotateShift(1).description, bandRowsShift(1, 1).description]),
    ).toBe('Board rotated clockwise, then rows 4–6 slid down 1');
  });

  it('leaves a single shift exactly as it was written', () => {
    expect(joinDescriptions([mirrorShift('diagonal').description])).toBe(
      mirrorShift('diagonal').description,
    );
    expect(joinDescriptions([])).toBe('');
  });
});
