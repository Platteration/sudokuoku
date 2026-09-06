import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Difficulty } from '../engine';
import { Stats } from '../storage';
import { Colors, radius, useStyles } from '../theme';
import { formatTime } from '../utils/time';
import PrimaryButton from './PrimaryButton';
import Sheet from './Sheet';

interface Props {
  visible: boolean;
  stats: Stats;
  onClose: () => void;
  onReset: () => void;
}

const ORDER: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

function Cell({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellValue}>{value}</Text>
      <Text style={styles.cellLabel}>{label}</Text>
    </View>
  );
}

export default function StatsSheet({ visible, stats, onClose, onReset }: Props) {
  const styles = useStyles(makeStyles);
  const totalPlayed = ORDER.reduce((n, d) => n + stats[d].played, 0);
  const totalWon = ORDER.reduce((n, d) => n + stats[d].won, 0);
  const recalled = ORDER.reduce((n, d) => n + stats[d].phantomsRecalled, 0);
  const missed = ORDER.reduce((n, d) => n + stats[d].phantomsMissed, 0);
  const recallPct = recalled + missed > 0 ? Math.round((100 * recalled) / (recalled + missed)) : null;

  return (
    <Sheet
      visible={visible}
      title="Statistics"
      onClose={onClose}
      footer={totalPlayed > 0 ? <PrimaryButton label="Reset statistics" variant="secondary" onPress={onReset} /> : undefined}
    >
      <View style={styles.row}>
        <Cell label="Played" value={String(totalPlayed)} styles={styles} />
        <Cell label="Won" value={String(totalWon)} styles={styles} />
        <Cell label="Phantom recall" value={recallPct === null ? '–' : `${recallPct}%`} styles={styles} />
      </View>
      {ORDER.map((d) => {
        const s = stats[d];
        return (
          <View key={d} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{d[0].toUpperCase() + d.slice(1)}</Text>
              <Text style={styles.cardMeta}>
                {s.won}/{s.played} won
              </Text>
            </View>
            <View style={styles.row}>
              <Cell label="Best time" value={s.bestTime === null ? '–' : formatTime(s.bestTime)} styles={styles} />
              <Cell label="Fewest shifts" value={s.fewestShifts === null ? '–' : String(s.fewestShifts)} styles={styles} />
              <Cell
                label="Recalled"
                value={s.phantomsRecalled + s.phantomsMissed === 0 ? '–' : `${s.phantomsRecalled}/${s.phantomsRecalled + s.phantomsMissed}`}
                styles={styles}
              />
            </View>
          </View>
        );
      })}
      {totalPlayed === 0 ? <Text style={styles.empty}>Finish a game and it will show up here.</Text> : null}
    </Sheet>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      marginTop: 6,
    },
    cell: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 8,
    },
    cellValue: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.primary,
      fontVariant: ['tabular-nums'],
    },
    cellLabel: {
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 2,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 10,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    cardMeta: {
      fontSize: 13,
      color: colors.textMuted,
    },
    empty: {
      marginTop: 16,
      textAlign: 'center',
      color: colors.textMuted,
    },
  });
