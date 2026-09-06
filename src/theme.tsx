import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

export const lightColors = {
  background: '#f4f5f9',
  surface: '#ffffff',
  text: '#1c2130',
  textMuted: '#6b7280',
  primary: '#3b5bdb',
  primarySoft: '#dbe4ff',
  onPrimary: '#ffffff',
  accent: '#f59f00',
  accentSoft: '#fff3bf',
  danger: '#e03131',
  dangerSoft: '#ffe3e3',
  success: '#2f9e44',
  successSoft: '#d3f9d8',
  line: '#c6cad4',
  lineStrong: '#1c2130',
  given: '#1c2130',
  entry: '#3b5bdb',
  cellSelected: '#a5b4fc',
  cellPeer: '#e9ecf7',
  cellSameDigit: '#fde68a',
  cellConflict: '#fecaca',
  cellPhantom: '#ede9fe',
  phantom: '#7c3aed',
  shiftBanner: '#1c2130',
  onBanner: '#ffffff',
  onBannerMuted: '#c7cad3',
  backdrop: 'rgba(0,0,0,0.45)',
};

export type Colors = typeof lightColors;

export const darkColors: Colors = {
  background: '#0f1117',
  surface: '#1a1d27',
  text: '#e6e8ef',
  textMuted: '#9aa0b0',
  primary: '#7c93ff',
  primarySoft: '#2a3566',
  onPrimary: '#0f1117',
  accent: '#fbbf24',
  accentSoft: '#3d3116',
  danger: '#f87171',
  dangerSoft: '#4a1d1d',
  success: '#4ade80',
  successSoft: '#14351f',
  line: '#343a4a',
  lineStrong: '#e6e8ef',
  given: '#e6e8ef',
  entry: '#8ea2ff',
  cellSelected: '#4c5bb8',
  cellPeer: '#232838',
  cellSameDigit: '#5a4a12',
  cellConflict: '#5a2323',
  cellPhantom: '#2d2547',
  phantom: '#b794f6',
  shiftBanner: '#232838',
  onBanner: '#ffffff',
  onBannerMuted: '#9aa0b0',
  backdrop: 'rgba(0,0,0,0.6)',
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
};

export type ThemePreference = 'system' | 'light' | 'dark';

interface Theme {
  colors: Colors;
  dark: boolean;
}

const ThemeContext = createContext<Theme>({ colors: lightColors, dark: false });

export function ThemeProvider({
  preference,
  children,
}: {
  preference: ThemePreference;
  children: React.ReactNode;
}) {
  const scheme = useColorScheme();
  const dark = preference === 'dark' || (preference === 'system' && scheme === 'dark');
  const value = useMemo<Theme>(() => ({ colors: dark ? darkColors : lightColors, dark }), [dark]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** Memoises a StyleSheet factory against the current palette. */
export function useStyles<T>(factory: (colors: Colors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [colors, factory]);
}
