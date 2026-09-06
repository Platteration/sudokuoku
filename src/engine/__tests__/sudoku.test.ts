import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import {
  CELLS,
  CLUE_TARGET,
  countSolutions,
  findConflicts,
  generatePuzzle,
  generateSolution,
  isComplete,
  isValidGrid,
  solve,
} from '../sudoku';

describe('generateSolution', () => {
  it('produces a complete, valid grid', () => {
    const g = generateSolution(createRng(1));
    expect(g).toHaveLength(CELLS);
    expect(isComplete(g)).toBe(true);
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const a = generateSolution(createRng(42));
    const b = generateSolution(createRng(42));
    const c = generateSolution(createRng(43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('generatePuzzle', () => {
  it.each(['easy', 'medium', 'hard', 'expert'] as const)(
    'builds a uniquely solvable %s puzzle whose clues match the solution',
    (difficulty) => {
      const { clues, solution } = generatePuzzle(createRng(7), difficulty);
      expect(isComplete(solution)).toBe(true);
      expect(isValidGrid(clues)).toBe(true);
      const clueCount = clues.filter((v) => v !== 0).length;
      expect(clueCount).toBeGreaterThanOrEqual(CLUE_TARGET[difficulty]);
      expect(clueCount).toBeLessThan(CELLS);
      for (let p = 0; p < CELLS; p++) {
        if (clues[p] !== 0) expect(clues[p]).toBe(solution[p]);
      }
      expect(countSolutions(clues, 2)).toBe(1);
      expect(solve(clues)).toEqual(solution);
    },
  );

  it('easier puzzles have more clues', () => {
    const easy = generatePuzzle(createRng(9), 'easy').clues.filter(Boolean).length;
    const hard = generatePuzzle(createRng(9), 'hard').clues.filter(Boolean).length;
    expect(easy).toBeGreaterThan(hard);
  });
});

describe('validation helpers', () => {
  it('finds conflicts across rows, columns and boxes', () => {
    const g = new Array(CELLS).fill(0);
    g[0] = 5;
    g[8] = 5; // same row
    expect([...findConflicts(g)].sort()).toEqual([0, 8]);
    g[8] = 0;
    g[72] = 5; // same column
    expect([...findConflicts(g)].sort()).toEqual([0, 72]);
    g[72] = 0;
    g[10] = 5; // same box
    expect([...findConflicts(g)].sort((a, b) => a - b)).toEqual([0, 10]);
    expect(isValidGrid(g)).toBe(false);
  });

  it('countSolutions reports 0 for an impossible grid', () => {
    const g = new Array(CELLS).fill(0);
    g[0] = 1;
    g[1] = 1;
    expect(countSolutions(g)).toBe(0);
    expect(solve(g)).toBeNull();
  });

  it('countSolutions reports 2+ for an under-constrained grid', () => {
    const { clues } = generatePuzzle(createRng(2), 'easy');
    const g = clues.slice();
    // Removing a whole box of clues almost always breaks uniqueness.
    for (let p = 0; p < CELLS; p++) if (Math.floor(p / 27) === 0 && (p % 9) < 3) g[p] = 0;
    expect(countSolutions(g, 2)).toBe(2);
  });
});
