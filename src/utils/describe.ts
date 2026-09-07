import { GameState, colOf, isLocked, rowOf } from '../engine';

/** Reads a note bitmask as "1, 4 and 7". */
function listNotes(mask: number): string {
  const digits: number[] = [];
  for (let d = 1; d <= 9; d++) if (mask & (1 << d)) digits.push(d);
  if (digits.length === 0) return '';
  if (digits.length === 1) return String(digits[0]);
  return `${digits.slice(0, -1).join(', ')} and ${digits[digits.length - 1]}`;
}

/**
 * What a screen reader says for one cell. The board rearranges under the
 * player, so the label has to carry the position and the contents together:
 * announcing only "row 3, column 5" would be useless once things move.
 */
export function describeCell(state: GameState, pos: number): string {
  const where = `Row ${rowOf(pos) + 1}, column ${colOf(pos) + 1}`;
  if (isLocked(state, pos)) {
    const ph = state.phantoms[pos]!;
    const left = ph.unlockAtMove - state.moves;
    return `${where}, faded and locked for ${left} more ${left === 1 ? 'move' : 'moves'}`;
  }
  const value = state.values[pos];
  if (value !== 0) return `${where}, ${value}${state.given[pos] ? ', given' : ''}`;
  const notes = listNotes(state.notes[pos]);
  if (notes) return `${where}, empty, noted ${notes}`;
  return `${where}, empty`;
}

/** What is read out after the board moves. */
export function describeShift(description: string, selected: number | null): string {
  const where =
    selected === null
      ? ''
      : ` Your cell is now row ${rowOf(selected) + 1}, column ${colOf(selected) + 1}.`;
  return `${description}.${where}`;
}
