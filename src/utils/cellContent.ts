import { GameState, Phantom, isLocked } from '../engine';

/**
 * The layers one cell draws, top to bottom. Everything here is drawn: this is
 * not a choice between a phantom, a digit and pencil marks.
 */
export interface CellContent {
  /** The faded digit, drawn over the cell while its fade-out runs. */
  phantom: Phantom | null;
  /** Draw the ghost marker and the moves left before the cell unlocks. */
  marker: boolean;
  /** The digit in the cell, or 0 for none. */
  value: number;
  /** Pencil marks as a bitmask, or 0 for none. */
  notes: number;
}

/**
 * What a cell shows right now.
 *
 * A phantom record deliberately lingers after its lock expires so the recall
 * can be scored when the cell is refilled. While it lingers the cell is empty
 * and fully playable, so pencil marks written into it have to be drawn: the
 * faded digit is an overlay on the way out, never a replacement for the
 * cell's contents. `describeCell` says the same thing to a screen reader.
 */
export function cellContent(state: GameState, pos: number): CellContent {
  const value = state.values[pos];
  return {
    phantom: state.phantoms[pos],
    marker: state.settings.phantomMarkers && isLocked(state, pos),
    value,
    notes: value === 0 ? state.notes[pos] : 0,
  };
}
