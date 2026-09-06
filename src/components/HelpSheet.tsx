import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors } from '../theme';
import Sheet from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function HelpSheet({ visible, onClose }: Props) {
  return (
    <Sheet visible={visible} title="How Sudokuoku works" onClose={onClose}>
      <Text style={styles.p}>
        It is ordinary Sudoku with one twist: after every move the board shifts, and you
        never know which shift is coming.
      </Text>
      <Text style={styles.h}>The shifts</Text>
      <Text style={styles.p}>• The three rows inside one band slide up or down.</Text>
      <Text style={styles.p}>• The three columns inside one stack slide left or right.</Text>
      <Text style={styles.p}>• Every row shifts down by 3 or 6, or every column shifts across by 3 or 6.</Text>
      <Text style={styles.p}>• The whole board rotates a quarter turn, so every ring of cells turns together.</Text>
      <Text style={styles.p}>• The board flips top-to-bottom, left-to-right, or across a diagonal.</Text>
      <Text style={styles.p}>• Every 3×3 box slides its contents the same way, wrapping inside the box.</Text>
      <Text style={styles.p}>• Optional: every digit becomes the next one up, with 9 wrapping to 1.</Text>
      <Text style={styles.h}>Why it stays solvable</Text>
      <Text style={styles.p}>
        Each of these shifts is a symmetry of Sudoku. Move any valid solution with one of them
        and you get another valid solution. The givens, your entries, your notes and the hidden
        answer all move together, so a correct entry stays correct and the puzzle keeps its
        single solution after every shift.
      </Text>
      <Text style={styles.p}>
        Shifts that would break that rule, like turning a single ring of cells or scrambling
        one box on its own, are never used.
      </Text>
      <Text style={styles.h}>Phantom challenge (optional)</Text>
      <Text style={styles.p}>
        Turn it on in Settings and, every few moves, one filled cell fades away. The digit is
        gone from the board and the cell locks for a number of moves: nothing can be entered
        there, not even a note. Remember what was there, keep reasoning as if it were still
        in place while the board keeps shifting, and put it back once the lock lifts. Givens
        can fade too, and a faded given has to be refilled to finish the puzzle.
      </Text>
      <Text style={styles.p}>
        Locked cells show a ghost with the moves left until they unlock. Switch the markers
        off to track the phantoms purely from memory.
      </Text>
      <Text style={styles.h}>Tips</Text>
      <Text style={styles.p}>• Your selection follows the cell it was on, so you can keep working there.</Text>
      <Text style={styles.p}>• Notes do not count as moves, so pencil freely.</Text>
      <Text style={styles.p}>• Undo rewinds the shift as well as the move.</Text>
      <Text style={styles.p}>• Turn shifts down to every few moves, or off entirely, in Settings.</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  h: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginTop: 16,
    marginBottom: 6,
  },
  p: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    marginBottom: 6,
  },
});
