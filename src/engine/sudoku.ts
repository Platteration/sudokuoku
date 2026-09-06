import { Rng, shuffle } from './rng';

export const SIZE = 9;
export const CELLS = 81;

/** A grid is 81 digits, row-major. 0 means empty. */
export type Grid = number[];

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

/** Target number of clues left on the board for each difficulty. */
export const CLUE_TARGET: Record<Difficulty, number> = {
  easy: 40,
  medium: 34,
  hard: 29,
  expert: 25,
};

export const rowOf = (p: number): number => Math.floor(p / SIZE);
export const colOf = (p: number): number => p % SIZE;
export const boxOf = (p: number): number =>
  Math.floor(rowOf(p) / 3) * 3 + Math.floor(colOf(p) / 3);
export const posOf = (r: number, c: number): number => r * SIZE + c;

/** Indices of every cell that shares a row, column or box with p (excluding p). */
export const PEERS: number[][] = (() => {
  const peers: number[][] = [];
  for (let p = 0; p < CELLS; p++) {
    const set = new Set<number>();
    const r = rowOf(p);
    const c = colOf(p);
    for (let i = 0; i < SIZE; i++) {
      set.add(posOf(r, i));
      set.add(posOf(i, c));
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) set.add(posOf(br + dr, bc + dc));
    }
    set.delete(p);
    peers.push([...set]);
  }
  return peers;
})();

/** True when no row, column or box contains a repeated non-zero digit. */
export function isValidGrid(grid: Grid): boolean {
  for (let p = 0; p < CELLS; p++) {
    const v = grid[p];
    if (v === 0) continue;
    for (const q of PEERS[p]) if (grid[q] === v) return false;
  }
  return true;
}

export function isComplete(grid: Grid): boolean {
  return grid.every((v) => v !== 0) && isValidGrid(grid);
}

/** Positions that currently clash with a peer holding the same digit. */
export function findConflicts(grid: Grid): Set<number> {
  const out = new Set<number>();
  for (let p = 0; p < CELLS; p++) {
    const v = grid[p];
    if (v === 0) continue;
    for (const q of PEERS[p]) {
      if (grid[q] === v) {
        out.add(p);
        out.add(q);
      }
    }
  }
  return out;
}

/** Bitmask of digits that may legally go in p given the current grid. */
export function candidates(grid: Grid, p: number): number {
  let used = 0;
  for (const q of PEERS[p]) if (grid[q] !== 0) used |= 1 << grid[q];
  return ~used & 0x3fe; // bits 1..9
}

function popcount(x: number): number {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

/**
 * Counts solutions up to `limit` (2 is enough to test uniqueness).
 * Uses a most-constrained-cell-first backtracking search.
 */
export function countSolutions(grid: Grid, limit = 2): number {
  if (!isValidGrid(grid)) return 0;
  const g = grid.slice();
  let count = 0;

  const search = (): boolean => {
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let p = 0; p < CELLS; p++) {
      if (g[p] !== 0) continue;
      const mask = candidates(g, p);
      const n = popcount(mask);
      if (n === 0) return false;
      if (n < bestCount) {
        best = p;
        bestMask = mask;
        bestCount = n;
        if (n === 1) break;
      }
    }
    if (best === -1) {
      count++;
      return count >= limit;
    }
    for (let d = 1; d <= 9; d++) {
      if (!(bestMask & (1 << d))) continue;
      g[best] = d;
      if (search()) return true;
    }
    g[best] = 0;
    return false;
  };

  search();
  return count;
}

/** Solves a grid in place-copy; returns null if there is no solution. */
export function solve(grid: Grid): Grid | null {
  if (!isValidGrid(grid)) return null;
  const g = grid.slice();
  const search = (): boolean => {
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let p = 0; p < CELLS; p++) {
      if (g[p] !== 0) continue;
      const mask = candidates(g, p);
      const n = popcount(mask);
      if (n === 0) return false;
      if (n < bestCount) {
        best = p;
        bestMask = mask;
        bestCount = n;
        if (n === 1) break;
      }
    }
    if (best === -1) return true;
    for (let d = 1; d <= 9; d++) {
      if (!(bestMask & (1 << d))) continue;
      g[best] = d;
      if (search()) return true;
    }
    g[best] = 0;
    return false;
  };
  return search() ? g : null;
}

/** Builds a random, fully solved grid. */
export function generateSolution(rng: Rng): Grid {
  const g: Grid = new Array(CELLS).fill(0);
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const fill = (p: number): boolean => {
    if (p === CELLS) return true;
    const mask = candidates(g, p);
    for (const d of shuffle(rng, digits)) {
      if (!(mask & (1 << d))) continue;
      g[p] = d;
      if (fill(p + 1)) return true;
    }
    g[p] = 0;
    return false;
  };
  fill(0);
  return g;
}

export interface Puzzle {
  /** The starting board; 0 for cells the player must fill. */
  clues: Grid;
  /** The unique solution. */
  solution: Grid;
}

/**
 * Removes clues from a full solution in random order, keeping only removals
 * that leave exactly one solution. Stops at the difficulty's clue target.
 */
export function generatePuzzle(rng: Rng, difficulty: Difficulty): Puzzle {
  const solution = generateSolution(rng);
  const clues = solution.slice();
  const target = CLUE_TARGET[difficulty];
  let remaining = CELLS;
  const order = shuffle(rng, Array.from({ length: CELLS }, (_, i) => i));
  for (const p of order) {
    if (remaining <= target) break;
    const saved = clues[p];
    clues[p] = 0;
    if (countSolutions(clues, 2) === 1) {
      remaining--;
    } else {
      clues[p] = saved;
    }
  }
  return { clues, solution };
}
