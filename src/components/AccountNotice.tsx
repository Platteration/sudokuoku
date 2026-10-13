import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAccount } from '../account';
import { WORDS } from '../accountModel';
import { Colors, radius, useStyles } from '../theme';
import Press from './ui/Press';

/**
 * The website's one line about the account, at the top of the game screen, which is where
 * Google and Stripe send the visitor back to: a sign-in that did not complete, a payment that
 * has arrived, or one still on its way. Drawn only while there is one, which in the iOS and
 * Android apps, and on a site without the api/, is never.
 */
export default function AccountNotice() {
  const styles = useStyles(makeStyles);
  const { state, dismissNotice } = useAccount();
  if (!state.notice) return null;
  return (
    <View style={styles.notice} accessibilityRole="alert">
      <Text style={styles.text}>{state.notice}</Text>
      <Press onPress={dismissNotice} accessibilityRole="button" accessibilityLabel={WORDS.dismiss} hitSlop={8} style={styles.dismiss}>
        <Text style={styles.dismissText}>{WORDS.dismiss}</Text>
      </Press>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 8,
    },
    text: {
      flex: 1,
      fontSize: 14,
      color: colors.text,
      marginRight: 10,
    },
    dismiss: {
      paddingVertical: 4,
    },
    dismissText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      textDecorationLine: 'underline',
    },
  });
