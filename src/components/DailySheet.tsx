import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  DailyConfig,
  Profile,
  profileStreak,
  shareText,
  shiftDateKey,
  parseDateKey,
} from '../engine';
import { Colors, radius, useStyles } from '../theme';
import { formatTime } from '../utils/time';
import PrimaryButton from './PrimaryButton';
import Sheet from './Sheet';

interface Props {
  visible: boolean;
  todayKey: string;
  config: DailyConfig;
  profile: Profile;
  /** A daily game for today exists and is still being played. */
  inProgress: boolean;
  /** The daily is the game currently on screen. */
  active: boolean;
  onClose: () => void;
  onPlay: () => void;
  onShare: (text: string) => void;
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function untilMidnight(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.max(0, Math.round((next.getTime() - now.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function DailySheet(p: Props) {
  const styles = useStyles(makeStyles);
  const result = p.profile.daily[p.todayKey];
  const streak = profileStreak(p.profile, p.todayKey);
  const week = Array.from({ length: 7 }, (_, i) => shiftDateKey(p.todayKey, i - 6));

  return (
    <Sheet
      visible={p.visible}
      title="Daily challenge"
      onClose={p.onClose}
      footer={
        result ? (
          <PrimaryButton
            label="Share result"
            icon="share"
            onPress={() => p.onShare(shareText(result, streak))}
          />
        ) : (
          <PrimaryButton
            label={p.active ? 'Back to the board' : p.inProgress ? 'Continue today’s daily' : 'Play today’s daily'}
            icon={p.inProgress || p.active ? 'chevron' : 'play'}
            onPress={() => {
              p.onPlay();
              p.onClose();
            }}
          />
        )
      }
    >
      <View style={styles.card}>
        <Text style={styles.date}>{p.todayKey}</Text>
        <Text style={styles.label}>{p.config.label}</Text>
        <Text style={styles.hint}>
          Everyone gets the same board today. Shifts every move
          {p.config.phantom ? ', and digits fade away' : ''}. One attempt, no restarts.
        </Text>
        {result ? (
          <View style={styles.resultRow}>
            <Stat label="Time" value={formatTime(result.elapsed)} styles={styles} />
            <Stat label="Moves" value={String(result.moves)} styles={styles} />
            <Stat label="Shifts" value={String(result.shifts)} styles={styles} />
            {result.phantom ? (
              <Stat label="Recalled" value={`${result.phantomsRecalled}/${result.phantomsRecalled + result.phantomsMissed}`} styles={styles} />
            ) : (
              <Stat label="Hints" value={String(result.hints)} styles={styles} />
            )}
            <Stat label="XP" value={`+${result.xp}`} styles={styles} />
          </View>
        ) : (
          <Text style={styles.status}>{p.inProgress ? 'In progress' : 'Not started yet'}</Text>
        )}
      </View>

      <View style={styles.streakRow}>
        <View style={styles.streakCard}>
          <Text style={styles.streakValue}>🔥 {streak}</Text>
          <Text style={styles.streakLabel}>{streak === 1 ? 'day streak' : 'day streak'}</Text>
        </View>
        <View style={styles.streakCard}>
          <Text style={styles.streakValue}>{p.profile.bestStreak}</Text>
          <Text style={styles.streakLabel}>best streak</Text>
        </View>
        <View style={styles.streakCard}>
          <Text style={styles.streakValue}>❄️ {p.profile.freezes}</Text>
          <Text style={styles.streakLabel}>{p.profile.freezes === 1 ? 'freeze' : 'freezes'}</Text>
        </View>
      </View>

      <Text style={styles.section}>Last 7 days</Text>
      <View style={styles.week}>
        {week.map((key) => {
          const done = !!p.profile.daily[key];
          const frozen = !done && !!p.profile.frozenDays[key];
          const isToday = key === p.todayKey;
          return (
            <View key={key} style={styles.day}>
              <View
                style={[
                  styles.dot,
                  done && styles.dotDone,
                  frozen && styles.dotFrozen,
                  isToday && !done && styles.dotToday,
                ]}
              >
                <Text style={[styles.dotText, done && styles.dotTextDone]}>
                  {done ? '✓' : frozen ? '❄' : ''}
                </Text>
              </View>
              <Text style={[styles.dayLetter, isToday && styles.dayLetterToday]}>
                {DAY_LETTERS[parseDateKey(key).getDay()]}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.next}>
        Next daily in {untilMidnight()}. Miss a day and a freeze covers it, if you have one. You
        get one freeze a month, up to three.
      </Text>
    </Sheet>
  );
}

function Stat({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
      padding: 14,
      marginTop: 4,
    },
    date: {
      fontSize: 13,
      color: colors.textMuted,
      fontVariant: ['tabular-nums'],
    },
    label: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
      marginTop: 2,
    },
    hint: {
      fontSize: 13,
      color: colors.textMuted,
      marginTop: 6,
    },
    status: {
      marginTop: 10,
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
    },
    resultRow: {
      flexDirection: 'row',
      marginTop: 10,
    },
    stat: {
      flex: 1,
      alignItems: 'center',
    },
    statValue: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.primary,
      fontVariant: ['tabular-nums'],
    },
    statLabel: {
      fontSize: 11,
      color: colors.textMuted,
    },
    streakRow: {
      flexDirection: 'row',
      marginTop: 10,
    },
    streakCard: {
      flex: 1,
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
      paddingVertical: 10,
      marginHorizontal: 3,
    },
    streakValue: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
    },
    streakLabel: {
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 2,
    },
    section: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 18,
      marginBottom: 8,
    },
    week: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    day: {
      alignItems: 'center',
      flex: 1,
    },
    dot: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dotDone: {
      backgroundColor: colors.success,
      borderColor: colors.success,
    },
    dotFrozen: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    dotToday: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    dotText: {
      color: colors.textMuted,
      fontWeight: '700',
    },
    dotTextDone: {
      color: '#fff',
    },
    dayLetter: {
      marginTop: 4,
      fontSize: 12,
      color: colors.textMuted,
    },
    dayLetterToday: {
      color: colors.primary,
      fontWeight: '700',
    },
    next: {
      marginTop: 14,
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
    },
  });
