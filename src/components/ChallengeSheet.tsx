import * as Clipboard from 'expo-clipboard';
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Challenge,
  GameState,
  challengeFromState,
  decodeChallenge,
  encodeChallenge,
} from '../engine';
import { Colors, radius, useStyles, useTheme } from '../theme';
import { formatTime } from '../utils/time';
import PrimaryButton from './PrimaryButton';
import Sheet from './Sheet';
import Icon from './ui/Icon';

interface Props {
  visible: boolean;
  /** The game a challenge would be built from, when there is one worth sharing. */
  state: GameState;
  /** The challenge currently being played, if any. */
  active: Challenge | null;
  onClose: () => void;
  onPlay: (challenge: Challenge) => void;
  onShare: (text: string) => void;
}

/** Builds the link and the plain code for a challenge. */
export function challengeLink(code: string): string {
  return `https://sudokuoku.app/c/${code}`;
}

function inviteText(code: string, withGhost: boolean): string {
  return [
    withGhost
      ? 'I set you a Sudokuoku board. Can you beat my time?'
      : 'I set you a Sudokuoku board. Same grid, same shifts.',
    challengeLink(code),
    '',
    `No link? Paste this code into the app:\n${code}`,
  ].join('\n');
}

export default function ChallengeSheet({ visible, state, active, onClose, onPlay, onShare }: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // A finished game can carry the solve as a ghost to race against.
  const canSendGhost = state.status === 'won' && state.log.length > 0;
  const outgoing = challengeFromState(state, canSendGhost);
  const code = encodeChallenge(outgoing);

  const send = async () => {
    await onShare(inviteText(code, canSendGhost));
  };

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onShare(code);
    }
  };

  const open = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    // Accept a bare code or a full link, since people paste both.
    const cleaned = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed;
    const result = decodeChallenge(cleaned);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setPasted('');
    onPlay(result.challenge);
    onClose();
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        setPasted(text);
        open(text);
      }
    } catch {
      setError('Could not read the clipboard.');
    }
  };

  return (
    <Sheet visible={visible} title="Challenge a friend" onClose={onClose}>
      {active ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>You are playing a challenge</Text>
          <Text style={styles.cardText}>
            {active.difficulty[0].toUpperCase() + active.difficulty.slice(1)} · seed{' '}
            {active.seed}
          </Text>
          {active.ghost ? (
            <View style={styles.ghostRow}>
              <Icon name="flame" size={16} color={colors.accent} />
              <Text style={styles.ghostText}>
                Their time to beat: {formatTime(active.ghost.totalSeconds)}
                {active.ghost.hints > 0 ? ` (${active.ghost.hints} hints)` : ', no hints'}
              </Text>
            </View>
          ) : (
            <Text style={styles.cardText}>No ghost attached, so this is a fresh race.</Text>
          )}
        </View>
      ) : null}

      <Text style={styles.section}>Send a board</Text>
      <Text style={styles.hint}>
        Your friend gets the identical grid and the identical run of shifts. Nothing is uploaded:
        the whole board travels inside the code.
        {canSendGhost ? ' Your solve rides along, so they race your pace.' : ''}
      </Text>
      <View style={styles.codeBox}>
        <Text style={styles.code} numberOfLines={3} selectable>
          {code}
        </Text>
      </View>
      <PrimaryButton label="Send challenge" icon="share" onPress={send} />
      <PrimaryButton
        label={copied ? 'Code copied' : 'Copy code'}
        icon={copied ? 'check' : 'copy'}
        variant="secondary"
        size="md"
        onPress={copy}
      />

      <Text style={styles.section}>Open a challenge</Text>
      <Text style={styles.hint}>Paste a code or a link a friend sent you.</Text>
      <TextInput
        value={pasted}
        onChangeText={(t) => {
          setPasted(t);
          setError(null);
        }}
        placeholder="Paste code here"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        style={styles.input}
        accessibilityLabel="Challenge code"
      />
      {error ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      <PrimaryButton
        label="Play this board"
        icon="play"
        onPress={() => open(pasted)}
        disabled={pasted.trim().length === 0}
      />
      <PrimaryButton
        label="Paste from clipboard"
        variant="secondary"
        size="md"
        onPress={pasteFromClipboard}
      />

      <Text style={styles.footnote}>
        Times are worked out on each phone, so treat a friend’s result as friendly bragging
        rather than an official score.
      </Text>
    </Sheet>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.primarySoft,
      borderRadius: radius.md,
      padding: 14,
      marginTop: 4,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    cardText: {
      fontSize: 13,
      color: colors.textMuted,
      marginTop: 2,
    },
    ghostRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
    },
    ghostText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      marginLeft: 6,
      flex: 1,
    },
    section: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 20,
      marginBottom: 6,
    },
    hint: {
      fontSize: 13,
      color: colors.textMuted,
      marginBottom: 8,
    },
    codeBox: {
      backgroundColor: colors.surface,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.line,
      padding: 10,
    },
    code: {
      fontSize: 11,
      color: colors.textMuted,
      fontFamily: undefined,
    },
    input: {
      backgroundColor: colors.surface,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: 12,
      paddingVertical: 10,
      minHeight: 64,
      color: colors.text,
      fontSize: 13,
      textAlignVertical: 'top',
    },
    error: {
      backgroundColor: colors.dangerSoft,
      borderRadius: radius.sm,
      padding: 10,
      marginTop: 8,
    },
    errorText: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: '600',
    },
    footnote: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 18,
      textAlign: 'center',
    },
  });
