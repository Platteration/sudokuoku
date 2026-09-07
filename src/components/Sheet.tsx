import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors, radius, shadow, useStyles, useTheme } from '../theme';
import Icon from './ui/Icon';
import Press from './ui/Press';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Bottom sheet style modal used by settings, help and the win screen. */
export default function Sheet({ visible, title, onClose, children, footer }: Props) {
  const styles = useStyles(makeStyles);
  const { colors, dark } = useTheme();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, shadow(3, dark)]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Press
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              style={styles.close}
            >
              <Icon name="close" size={19} color={colors.textMuted} />
            </Press>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '88%',
    paddingBottom: 24,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 21,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
  },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.cellPeer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.background,
  },
  });
