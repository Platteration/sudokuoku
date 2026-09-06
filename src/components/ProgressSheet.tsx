import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BADGES, Badge, Difficulty, Profile, currentStreak, levelInfo } from '../engine';
import { Colors, radius, useStyles } from '../theme';
import { formatTime } from '../utils/time';
import PrimaryButton from './PrimaryButton';
import Sheet from './Sheet';

interface Props {
  visible: boolean;
  profile: Profile;
  todayKey: string;
  onClose: () => void;
  onReset: () => void;
}

const ORDER: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
const GROUPS: { key: Badge['group']; title: string }[] = [
  { key: 'wins', title: 'Wins' },
  { key: 'shifts', title: 'Shifts' },
  { key: 'phantom', title: 'Phantoms' },
  { key: 'daily', title: 'Daily' },
  { key: 'style', title: 'Style' },
];

export default function ProgressSheet({ visible, profile, todayKey, onClose, onReset }: Props) {
  const styles = useStyles(makeStyles);
  const level = levelInfo(profile.xp);
  const streak = currentStreak(profile.daily, todayKey);
  const unlocked = Object.keys(profile.badges).length;
  const pct = level.span > 0 ? Math.min(1, level.into / level.span) : 1;

  return (
    <Sheet
      visible={visible}
      title="Progress"
      onClose={onClose}
      footer={profile.totals.played > 0 ? <PrimaryButton label="Reset progress" variant="secondary" onPress={onReset} /> : undefined}
    >
      <View style={styles.levelCard}>
        <View style={styles.levelRow}>
          <View style={styles.levelBubble}>
            <Text style={styles.levelNumber}>{level.level}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.levelTitle}>{level.title}</Text>
            <Text style={styles.levelMeta}>
              {profile.xp} XP · {level.span - level.into} to level {level.level + 1}
            </Text>
          </View>
        </View>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
        </View>
      </View>

      <View style={styles.row}>
        <Cell label="Won" value={`${profile.totals.won}/${profile.totals.played}`} styles={styles} />
        <Cell label="Shifts survived" value={String(profile.totals.shifts)} styles={styles} />
        <Cell label="Streak" value={`🔥 ${streak}`} styles={styles} />
        <Cell label="Badges" value={`${unlocked}/${BADGES.length}`} styles={styles} />
      </View>

      <Text style={styles.section}>Badges</Text>
      {GROUPS.map((g) => (
        <View key={g.key}>
          <Text style={styles.groupTitle}>{g.title}</Text>
          <View style={styles.grid}>
            {BADGES.filter((b) => b.group === g.key).map((b) => {
              const when = profile.badges[b.id];
              return (
                <View key={b.id} style={[styles.badge, !when && styles.badgeLocked]}>
                  <Text style={styles.badgeIcon}>{when ? b.icon : '🔒'}</Text>
                  <Text style={styles.badgeTitle} numberOfLines={1}>
                    {b.title}
                  </Text>
                  <Text style={styles.badgeDesc} numberOfLines={3}>
                    {b.description}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ))}

      <Text style={styles.section}>By difficulty</Text>
      {ORDER.map((d) => {
        const s = profile.stats[d];
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
    </Sheet>
  );
}

function Cell({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellValue}>{value}</Text>
      <Text style={styles.cellLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    levelCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
      padding: 14,
      marginTop: 4,
    },
    levelRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    levelBubble: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    levelNumber: {
      color: colors.onPrimary,
      fontSize: 20,
      fontWeight: '800',
    },
    levelTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    levelMeta: {
      fontSize: 13,
      color: colors.textMuted,
      marginTop: 2,
    },
    bar: {
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.primarySoft,
      marginTop: 12,
      overflow: 'hidden',
    },
    barFill: {
      height: '100%',
      backgroundColor: colors.primary,
    },
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
      fontSize: 16,
      fontWeight: '700',
      color: colors.primary,
      fontVariant: ['tabular-nums'],
    },
    cellLabel: {
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 2,
      textAlign: 'center',
    },
    section: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 18,
      marginBottom: 4,
    },
    groupTitle: {
      fontSize: 13,
      color: colors.text,
      marginTop: 8,
      marginBottom: 4,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -3,
    },
    badge: {
      width: '33.333%',
      paddingHorizontal: 3,
      paddingVertical: 3,
    },
    badgeLocked: {
      opacity: 0.45,
    },
    badgeIcon: {
      fontSize: 24,
      textAlign: 'center',
    },
    badgeTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginTop: 2,
    },
    badgeDesc: {
      fontSize: 10,
      color: colors.textMuted,
      textAlign: 'center',
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 8,
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
  });
