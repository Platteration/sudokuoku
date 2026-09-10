/**
 * Board shifts.
 *
 * Every shift here is a symmetry of Sudoku: it maps any valid solution to
 * another valid solution. Because the givens, the player's entries and the
 * hidden solution all move together, the board stays exactly as solvable
 * after a shift as it was before. Nothing the player has entered becomes
 * wrong (or right) because of a shift.
 *
 * The symmetries used are:
 *   - cycling the three rows inside one horizontal band (or all bands),
 *   - cycling the three columns inside one vertical stack (or all stacks),
 *   - cycling whole bands / whole stacks (rows or columns shifting by 3 or 6),
 *   - rotating the entire board a quarter turn (every ring turns together),
 *   - mirroring the board, and
 *   - relabelling digits (optional "digit shift").
 *
 * Rotating a single ring of cells, or scrambling the cells inside one box,
 * is deliberately NOT offered: those moves break rows and columns and would
 * leave an unsolvable board.
 */
import { CELLS, SIZE, colOf, posOf, rowOf } from './sudoku';
import { Rng, pick, randInt } from './rng';

export type ShiftKind =
  | 'band-rows' // rows inside one band cycle
  | 'stack-cols' // columns inside one stack cycle
  | 'bands' // whole rows shift by 3 or 6 (bands cycle)
  | 'stacks' // whole columns shift by 3 or 6 (stacks cycle)
  | 'rotate' // whole board rotates a quarter turn
  | 'mirror' // whole board flips
  | 'box-slide' // every 3x3 box slides its contents the same way
  | 'relabel'; // every digit d becomes d+k (mod 9)

export const ALL_SHIFT_KINDS: ShiftKind[] = [
  'band-rows',
  'stack-cols',
  'bands',
  'stacks',
  'rotate',
  'mirror',
  'box-slide',
  'relabel',
];

export const SHIFT_KIND_LABEL: Record<ShiftKind, string> = {
  'band-rows': 'Rows shift inside a band',
  'stack-cols': 'Columns shift inside a stack',
  bands: 'All rows shift by 3 or 6',
  stacks: 'All columns shift by 3 or 6',
  rotate: 'Board rotates a quarter turn',
  mirror: 'Board mirrors',
  'box-slide': 'Every 3×3 box slides',
  relabel: 'Digits shift (1→2→3…)',
};

/**
 * A coarse family per shift kind. The preview can name the family without
 * giving away the exact move, which keeps some of the surprise.
 */
export type ShiftCategory = 'rows' | 'columns' | 'board' | 'boxes' | 'digits';

export const SHIFT_CATEGORY: Record<ShiftKind, ShiftCategory> = {
  'band-rows': 'rows',
  bands: 'rows',
  'stack-cols': 'columns',
  stacks: 'columns',
  rotate: 'board',
  mirror: 'board',
  'box-slide': 'boxes',
  relabel: 'digits',
};

export const CATEGORY_LABEL: Record<ShiftCategory, string> = {
  rows: 'Rows will move',
  columns: 'Columns will move',
  board: 'The whole board will turn',
  boxes: 'The boxes will shuffle',
  digits: 'The digits will change',
};

export const CATEGORY_ICON: Record<ShiftCategory, string> = {
  rows: '⇅',
  columns: '⇄',
  board: '↻',
  boxes: '▦',
  digits: '#',
};

export interface Shift {
  kind: ShiftKind;
  /** Human readable description, e.g. "Rows 4–6 slid down 1". */
  description: string;
  /**
   * Position permutation: dest[oldPos] = newPos. Identity for 'relabel'.
   */
  dest: number[];
  /** For 'relabel': digit d becomes relabel[d]. Identity otherwise. */
  relabel: number[];
}

const IDENTITY_POS: number[] = Array.from({ length: CELLS }, (_, i) => i);
const IDENTITY_DIGITS: number[] = Array.from({ length: 10 }, (_, i) => i);

function fromMapping(
  kind: ShiftKind,
  description: string,
  map: (r: number, c: number) => [number, number],
): Shift {
  const dest = new Array<number>(CELLS);
  for (let p = 0; p < CELLS; p++) {
    const [nr, nc] = map(rowOf(p), colOf(p));
    dest[p] = posOf(nr, nc);
  }
  return { kind, description, dest, relabel: IDENTITY_DIGITS };
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

const rangeLabel = (start: number): string => `${start + 1}–${start + 3}`;

/** Rows in band `band` (0..2) cycle down by `k` (1 or 2). */
export function bandRowsShift(band: number, k: number): Shift {
  const dir = k === 1 ? 'down 1' : 'up 1';
  return fromMapping(
    'band-rows',
    `Rows ${rangeLabel(band * 3)} slid ${dir}`,
    (r, c) => {
      if (Math.floor(r / 3) !== band) return [r, c];
      return [band * 3 + mod(r + k, 3), c];
    },
  );
}

/** Columns in stack `stack` (0..2) cycle right by `k` (1 or 2). */
export function stackColsShift(stack: number, k: number): Shift {
  const dir = k === 1 ? 'right 1' : 'left 1';
  return fromMapping(
    'stack-cols',
    `Columns ${rangeLabel(stack * 3)} slid ${dir}`,
    (r, c) => {
      if (Math.floor(c / 3) !== stack) return [r, c];
      return [r, stack * 3 + mod(c + k, 3)];
    },
  );
}

/** Every row moves down by 3*k (k = 1 or 2). */
export function bandsShift(k: number): Shift {
  const n = 3 * k;
  const dir = k === 1 ? 'down 3' : 'up 3';
  return fromMapping('bands', `Every row shifted ${dir}`, (r, c) => [
    mod(r + n, SIZE),
    c,
  ]);
}

/** Every column moves right by 3*k (k = 1 or 2). */
export function stacksShift(k: number): Shift {
  const n = 3 * k;
  const dir = k === 1 ? 'right 3' : 'left 3';
  return fromMapping('stacks', `Every column shifted ${dir}`, (r, c) => [
    r,
    mod(c + n, SIZE),
  ]);
}

/** Whole-board rotation: quarter turns clockwise (1..3). */
export function rotateShift(quarterTurns: number): Shift {
  const q = mod(quarterTurns, 4);
  const label =
    q === 1 ? 'Board rotated clockwise' : q === 3 ? 'Board rotated counter-clockwise' : 'Board rotated a half turn';
  return fromMapping('rotate', label, (r, c) => {
    let nr = r;
    let nc = c;
    for (let i = 0; i < q; i++) {
      const t = nr;
      nr = nc;
      nc = SIZE - 1 - t;
    }
    return [nr, nc];
  });
}

export type MirrorAxis = 'horizontal' | 'vertical' | 'diagonal' | 'anti-diagonal';

export function mirrorShift(axis: MirrorAxis): Shift {
  switch (axis) {
    case 'horizontal':
      return fromMapping('mirror', 'Board flipped top to bottom', (r, c) => [
        SIZE - 1 - r,
        c,
      ]);
    case 'vertical':
      return fromMapping('mirror', 'Board flipped left to right', (r, c) => [
        r,
        SIZE - 1 - c,
      ]);
    case 'diagonal':
      return fromMapping('mirror', 'Board flipped across the diagonal', (r, c) => [
        c,
        r,
      ]);
    case 'anti-diagonal':
      return fromMapping(
        'mirror',
        'Board flipped across the other diagonal',
        (r, c) => [SIZE - 1 - c, SIZE - 1 - r],
      );
  }
}

/**
 * Every 3x3 box slides its contents down `dr` and right `dc` (each 0..2,
 * not both 0), wrapping inside the box. This is a row cycle applied to every
 * band plus a column cycle applied to every stack, so it stays valid.
 */
export function boxSlideShift(dr: number, dc: number): Shift {
  const parts: string[] = [];
  if (dr === 1) parts.push('down');
  if (dr === 2) parts.push('up');
  if (dc === 1) parts.push('right');
  if (dc === 2) parts.push('left');
  return fromMapping(
    'box-slide',
    `Every 3×3 box slid ${parts.join(' and ')}`,
    (r, c) => [
      Math.floor(r / 3) * 3 + mod(r + dr, 3),
      Math.floor(c / 3) * 3 + mod(c + dc, 3),
    ],
  );
}

/** Every digit d becomes ((d - 1 + k) mod 9) + 1, for k in 1..8. */
export function relabelShift(k: number): Shift {
  const relabel = IDENTITY_DIGITS.slice();
  for (let d = 1; d <= 9; d++) relabel[d] = ((d - 1 + k) % 9) + 1;
  return {
    kind: 'relabel',
    description: `Every digit became ${k} higher (9 wraps to 1)`,
    dest: IDENTITY_POS,
    relabel,
  };
}

/** Picks a random, non-identity shift of the given kind. */
export function randomShiftOfKind(rng: Rng, kind: ShiftKind): Shift {
  switch (kind) {
    case 'band-rows':
      return bandRowsShift(randInt(rng, 3), 1 + randInt(rng, 2));
    case 'stack-cols':
      return stackColsShift(randInt(rng, 3), 1 + randInt(rng, 2));
    case 'bands':
      return bandsShift(1 + randInt(rng, 2));
    case 'stacks':
      return stacksShift(1 + randInt(rng, 2));
    case 'rotate':
      return rotateShift(1 + randInt(rng, 3));
    case 'mirror':
      return mirrorShift(
        pick(rng, ['horizontal', 'vertical', 'diagonal', 'anti-diagonal'] as const),
      );
    case 'box-slide': {
      const options: [number, number][] = [];
      for (let dr = 0; dr < 3; dr++)
        for (let dc = 0; dc < 3; dc++) if (dr || dc) options.push([dr, dc]);
      const [dr, dc] = pick(rng, options);
      return boxSlideShift(dr, dc);
    }
    case 'relabel':
      return relabelShift(1 + randInt(rng, 8));
  }
}

/** Picks a random kind from those enabled, then a random shift of that kind. */
export function randomShift(rng: Rng, enabled: ShiftKind[]): Shift | null {
  if (enabled.length === 0) return null;
  return randomShiftOfKind(rng, pick(rng, enabled));
}

/**
 * Joins the parts of one move into a single sentence, e.g.
 * "Board rotated clockwise, then rows 4–6 slid down 1". A move may fire
 * several shifts (`shiftsPerMove`), and the player has to be told about all
 * of them: naming only one describes half of what they just watched happen.
 * Every description starts a sentence, so the later ones are lower-cased.
 */
export function joinDescriptions(parts: readonly string[]): string {
  const kept = parts.filter((p) => p.length > 0);
  return kept
    .map((p, i) => (i === 0 ? p : p[0].toLowerCase() + p.slice(1)))
    .join(', then ');
}

/** Moves array contents according to the shift's position permutation. */
export function permute<T>(items: readonly T[], shift: Shift): T[] {
  const out = new Array<T>(items.length);
  for (let p = 0; p < items.length; p++) out[shift.dest[p]] = items[p];
  return out;
}

/** Applies a shift to a digit grid: positions move, then digits relabel. */
export function applyToGrid(grid: readonly number[], shift: Shift): number[] {
  return permute(grid, shift).map((d) => shift.relabel[d]);
}

/** Applies a shift to a notes grid (bitmask per cell). */
export function applyToNotes(notes: readonly number[], shift: Shift): number[] {
  return permute(notes, shift).map((mask) => {
    let out = 0;
    for (let d = 1; d <= 9; d++) if (mask & (1 << d)) out |= 1 << shift.relabel[d];
    return out;
  });
}
