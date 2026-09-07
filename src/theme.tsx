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

/**
 * A theme pack is a pair of palettes. Each is written as a short set of
 * overrides on the classic light or dark palette, so a pack only has to name
 * the colours that make it distinctive.
 */
export interface ThemePack {
  id: string;
  name: string;
  description: string;
  light: Colors;
  dark: Colors;
}

const light = (o: Partial<Colors>): Colors => ({ ...lightColors, ...o });
const dark = (o: Partial<Colors>): Colors => ({ ...darkColors, ...o });

export const THEME_PACKS: ThemePack[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'The original ink and indigo.',
    light: lightColors,
    dark: darkColors,
  },
  {
    id: 'paper',
    name: 'Paper',
    description: 'Warm newsprint and a red pencil.',
    light: light({
      background: '#f3ece1',
      surface: '#fdfaf4',
      text: '#2b2620',
      textMuted: '#7d7365',
      primary: '#a4442f',
      primarySoft: '#f4dcd4',
      accent: '#a67c31',
      accentSoft: '#f6e7c8',
      line: '#d3c7b4',
      lineStrong: '#2b2620',
      given: '#2b2620',
      entry: '#a4442f',
      cellSelected: '#e8c5b8',
      cellPeer: '#f0e7d9',
      cellSameDigit: '#f2ddab',
      cellConflict: '#f0c9c2',
      cellPhantom: '#e9dfd0',
      phantom: '#8a7a5f',
      shiftBanner: '#2b2620',
      onBannerMuted: '#c9bfb0',
    }),
    dark: dark({
      background: '#1a1713',
      surface: '#241f19',
      text: '#efe6d8',
      textMuted: '#a1937f',
      primary: '#e0805f',
      primarySoft: '#4a2a1e',
      onPrimary: '#1a1713',
      accent: '#d9ad5e',
      accentSoft: '#3d3116',
      line: '#3d352b',
      lineStrong: '#efe6d8',
      given: '#efe6d8',
      entry: '#e0805f',
      cellSelected: '#5c3527',
      cellPeer: '#2c261f',
      cellSameDigit: '#4d3d16',
      cellConflict: '#4d2620',
      cellPhantom: '#332a20',
      phantom: '#bda67f',
      shiftBanner: '#2c261f',
    }),
  },
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'Phosphor green on black.',
    light: light({
      background: '#e4ece2',
      surface: '#f4faf2',
      text: '#123018',
      textMuted: '#4f7256',
      primary: '#17753a',
      primarySoft: '#cbe8d3',
      accent: '#8a6b12',
      accentSoft: '#f0e6bd',
      line: '#b3c9b6',
      lineStrong: '#123018',
      given: '#123018',
      entry: '#17753a',
      cellSelected: '#a8dcb8',
      cellPeer: '#dcebdc',
      cellSameDigit: '#e6dfa4',
      cellConflict: '#f2c9c4',
      cellPhantom: '#d7e6d9',
      phantom: '#3f7d5c',
      shiftBanner: '#123018',
      onBannerMuted: '#adc4b0',
    }),
    dark: dark({
      background: '#050b06',
      surface: '#0c160d',
      text: '#8ef2a4',
      textMuted: '#4f9a63',
      primary: '#38e07b',
      primarySoft: '#123a20',
      onPrimary: '#050b06',
      accent: '#d8e04a',
      accentSoft: '#31371a',
      danger: '#ff6b6b',
      line: '#1e3521',
      lineStrong: '#8ef2a4',
      given: '#8ef2a4',
      entry: '#38e07b',
      cellSelected: '#1d5c33',
      cellPeer: '#0f1f11',
      cellSameDigit: '#3a3f14',
      cellConflict: '#4a1c1c',
      cellPhantom: '#16281c',
      phantom: '#6fd6a8',
      shiftBanner: '#0f1f11',
      onBanner: '#8ef2a4',
      onBannerMuted: '#4f9a63',
    }),
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    description: 'Draughtsman lines on cyanotype blue.',
    light: light({
      background: '#e8eef6',
      surface: '#f7fafd',
      text: '#12314f',
      textMuted: '#5b7a99',
      primary: '#1f6fb2',
      primarySoft: '#cfe3f4',
      line: '#b6c9db',
      lineStrong: '#12314f',
      given: '#12314f',
      entry: '#1f6fb2',
      cellSelected: '#a9cdec',
      cellPeer: '#dfe9f4',
      cellSameDigit: '#f0dfa8',
      cellConflict: '#f3c8c8',
      cellPhantom: '#dde5f0',
      phantom: '#4d6f96',
      shiftBanner: '#12314f',
      onBannerMuted: '#adc0d3',
    }),
    dark: dark({
      background: '#0a2038',
      surface: '#103050',
      text: '#e4f0fb',
      textMuted: '#8fb0cc',
      primary: '#7fd4ff',
      primarySoft: '#1b4b74',
      onPrimary: '#0a2038',
      accent: '#ffd479',
      accentSoft: '#3d3416',
      line: '#25547e',
      lineStrong: '#e4f0fb',
      given: '#e4f0fb',
      entry: '#7fd4ff',
      cellSelected: '#2a6c9e',
      cellPeer: '#153c60',
      cellSameDigit: '#4a4318',
      cellConflict: '#5a2530',
      cellPhantom: '#1d3f5e',
      phantom: '#a9c8e6',
      shiftBanner: '#153c60',
    }),
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Dusk over a warm horizon.',
    light: light({
      background: '#fdf1ec',
      surface: '#fffaf7',
      text: '#3d2233',
      textMuted: '#8a6376',
      primary: '#d1466f',
      primarySoft: '#fbd9e3',
      accent: '#e08a2e',
      accentSoft: '#fce7cb',
      line: '#e3c8cd',
      lineStrong: '#3d2233',
      given: '#3d2233',
      entry: '#d1466f',
      cellSelected: '#f6bfd0',
      cellPeer: '#fae5ea',
      cellSameDigit: '#fbdfae',
      cellConflict: '#f8c6c2',
      cellPhantom: '#f0e0ee',
      phantom: '#9b5aa8',
      shiftBanner: '#3d2233',
      onBannerMuted: '#cbb0bd',
    }),
    dark: dark({
      background: '#1b1020',
      surface: '#2a172e',
      text: '#f7e4ef',
      textMuted: '#b491a7',
      primary: '#ff7fa4',
      primarySoft: '#5a2340',
      onPrimary: '#1b1020',
      accent: '#ffb457',
      accentSoft: '#4a3016',
      line: '#472a49',
      lineStrong: '#f7e4ef',
      given: '#f7e4ef',
      entry: '#ff7fa4',
      cellSelected: '#6d2f52',
      cellPeer: '#2f1c35',
      cellSameDigit: '#553a17',
      cellConflict: '#5c2229',
      cellPhantom: '#3a2247',
      phantom: '#d3a2e0',
      shiftBanner: '#2f1c35',
    }),
  },
  {
    id: 'contrast',
    name: 'High contrast',
    description: 'Maximum separation, colourblind safe.',
    light: light({
      background: '#ffffff',
      surface: '#ffffff',
      text: '#000000',
      textMuted: '#454545',
      primary: '#0033cc',
      primarySoft: '#cfd9ff',
      accent: '#8a5a00',
      accentSoft: '#ffe9b8',
      danger: '#b00020',
      dangerSoft: '#ffd6dd',
      success: '#005c2e',
      line: '#8a8a8a',
      lineStrong: '#000000',
      given: '#000000',
      entry: '#0033cc',
      cellSelected: '#9fb4ff',
      cellPeer: '#e6e6e6',
      cellSameDigit: '#ffe08a',
      cellConflict: '#ffc2cc',
      cellPhantom: '#e0d5f5',
      phantom: '#5b2d91',
      shiftBanner: '#000000',
      onBannerMuted: '#cccccc',
    }),
    dark: dark({
      background: '#000000',
      surface: '#101010',
      text: '#ffffff',
      textMuted: '#b8b8b8',
      primary: '#8ab4ff',
      primarySoft: '#1f3a6b',
      onPrimary: '#000000',
      accent: '#ffd166',
      accentSoft: '#4a3a10',
      danger: '#ff8a9b',
      dangerSoft: '#5c1622',
      success: '#6ee7a0',
      line: '#6a6a6a',
      lineStrong: '#ffffff',
      given: '#ffffff',
      entry: '#8ab4ff',
      cellSelected: '#2f5aa8',
      cellPeer: '#242424',
      cellSameDigit: '#5c4610',
      cellConflict: '#6b1f2c',
      cellPhantom: '#33245c',
      phantom: '#c9a8ff',
      shiftBanner: '#151515',
    }),
  },
];

export function themePack(id: string): ThemePack {
  return THEME_PACKS.find((p) => p.id === id) ?? THEME_PACKS[0];
}

interface Theme {
  colors: Colors;
  dark: boolean;
}

const ThemeContext = createContext<Theme>({ colors: lightColors, dark: false });

export function ThemeProvider({
  preference,
  pack = 'classic',
  children,
}: {
  preference: ThemePreference;
  pack?: string;
  children: React.ReactNode;
}) {
  const scheme = useColorScheme();
  const isDark = preference === 'dark' || (preference === 'system' && scheme === 'dark');
  const value = useMemo<Theme>(() => {
    const chosen = themePack(pack);
    return { colors: isDark ? chosen.dark : chosen.light, dark: isDark };
  }, [isDark, pack]);
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
