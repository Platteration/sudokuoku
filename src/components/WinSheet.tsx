import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GameState } from '../engine';
import { Colors, radius, useStyles } from '../theme';
import PrimaryButton from './PrimaryButton';
import Sheet from './Sheet';
import { formatTime } from '../utils/time';

interface Props {
  visible: boolean;
  state: GameState;
  elapsed: number;
  onClose: () => void;
  onNewGame: () => void;
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function WinSheet({ visible, state, elapsed, onClose, onNewGame }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <Sheet
      visible={visible}
      title="Solved!"
      onClose={onClose}
      footer={
        <>
          <PrimaryButton label="Play again" onPress={onNewGame} />
          <PrimaryButton label="Admire the board" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <Text style={styles.lead}>
        You pinned down every digit while the board kept moving under you.
      </Text>
      <View style={styles.stats}>
        <Stat label="Time" value={formatTime(elapsed)} />
        <Stat label="Moves" value={String(state.moves)} />
        <Stat label="Shifts" value={String(state.shiftCount)} />
        <Stat label="Hints" value={String(state.hintsUsed)} />
      </View>
      {state.phantomCount > 0 ? (
        <View style={[styles.stats, { marginTop: 6 }]}>
          <Stat label="Phantoms" value={String(state.phantomCount)} />
          <Stat label="Recalled" value={`${state.phantomsRecalled}/${state.phantomsRecalled + state.phantomsMissed}`} />
        </View>
      ) : null}
      <Text style={styles.meta}>
        {state.settings.difficulty[0].toUpperCase() + state.settings.difficulty.slice(1)} · seed {state.seed}
      </Text>
    </Sheet>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  lead: {
    fontSize: 16,
    color: colors.text,
    marginTop: 4,
    marginBottom: 16,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    marginHorizontal: 3,
    paddingVertical: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.primary,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  meta: {
    marginTop: 14,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  });
