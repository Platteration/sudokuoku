import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GameState, WinOutcome, levelInfo } from '../engine';
import { Colors, radius, useStyles } from '../theme';
import PrimaryButton from './PrimaryButton';
import Sheet from './Sheet';
import Confetti from './ui/Confetti';
import { formatTime } from '../utils/time';

interface Props {
  visible: boolean;
  state: GameState;
  outcome: WinOutcome | null;
  onClose: () => void;
  onNewGame: () => void;
  onShare?: () => void;
}

function Stat({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function WinSheet({ visible, state, outcome, onClose, onNewGame, onShare }: Props) {
  const styles = useStyles(makeStyles);
  const { width } = useWindowDimensions();
  const daily = state.mode === 'daily';
  const level = outcome ? levelInfo(outcome.profile.xp) : null;
  return (
    <Sheet
      visible={visible}
      title={daily ? 'Daily complete!' : 'Solved!'}
      onClose={onClose}
      footer={
        <>
          {daily && onShare ? (
            <PrimaryButton label="Share result" icon="share" onPress={onShare} />
          ) : null}
          <PrimaryButton
            label={daily ? 'Play a free game' : 'Play again'}
            icon="add"
            variant={daily ? 'secondary' : 'primary'}
            onPress={onNewGame}
          />
          <PrimaryButton label="Admire the board" variant="ghost" size="md" onPress={onClose} />
        </>
      }
    >
      <Confetti
        runKey={state.seed}
        width={width}
        active={visible}
        reduceMotion={state.settings.reduceMotion}
      />
      <Text style={styles.lead}>
        {daily
          ? `You beat today’s daily${outcome && outcome.streak > 1 ? ` and your streak is ${outcome.streak} days` : ''}.`
          : 'You pinned down every digit while the board kept moving under you.'}
      </Text>
      <View style={styles.stats}>
        <Stat label="Time" value={formatTime(state.elapsed)} styles={styles} />
        <Stat label="Moves" value={String(state.moves)} styles={styles} />
        <Stat label="Shifts" value={String(state.shiftCount)} styles={styles} />
        <Stat label="Hints" value={String(state.hintsUsed)} styles={styles} />
      </View>
      {state.phantomCount > 0 ? (
        <View style={[styles.stats, { marginTop: 6 }]}>
          <Stat label="Phantoms" value={String(state.phantomCount)} styles={styles} />
          <Stat label="Recalled" value={`${state.phantomsRecalled}/${state.phantomsRecalled + state.phantomsMissed}`} styles={styles} />
        </View>
      ) : null}

      {outcome && level ? (
        <View style={styles.xpCard}>
          <Text style={styles.xpGain}>+{outcome.xpGained} XP</Text>
          <Text style={styles.xpMeta}>
            {outcome.leveledUp ? `Level up! ` : ''}Level {level.level} · {level.title} · {level.span - level.into} XP to next
          </Text>
        </View>
      ) : null}

      {outcome && outcome.newBadges.length > 0 ? (
        <View style={styles.badges}>
          <Text style={styles.badgesTitle}>New badge{outcome.newBadges.length > 1 ? 's' : ''}</Text>
          {outcome.newBadges.map((b) => (
            <View key={b.id} style={styles.badgeRow}>
              <Text style={styles.badgeIcon}>{b.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.badgeTitle}>{b.title}</Text>
                <Text style={styles.badgeDesc}>{b.description}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={styles.meta}>
        {state.settings.difficulty[0].toUpperCase() + state.settings.difficulty.slice(1)} · {daily ? `daily ${state.dailyKey}` : `seed ${state.seed}`}
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
    xpCard: {
      marginTop: 12,
      backgroundColor: colors.primarySoft,
      borderRadius: radius.md,
      padding: 12,
      alignItems: 'center',
    },
    xpGain: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.primary,
    },
    xpMeta: {
      fontSize: 13,
      color: colors.text,
      marginTop: 2,
      textAlign: 'center',
    },
    badges: {
      marginTop: 12,
    },
    badgesTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 6,
    },
    badgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: radius.md,
      padding: 10,
      marginBottom: 6,
    },
    badgeIcon: {
      fontSize: 26,
      marginRight: 10,
    },
    badgeTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    badgeDesc: {
      fontSize: 12,
      color: colors.textMuted,
    },
    meta: {
      marginTop: 14,
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
    },
  });
