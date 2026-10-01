import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { Colors, ThemePreference, isDarkScheme, lightColors, themePack } from './palette';

export * from './palette';

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

/**
 * Cross-platform elevation. iOS reads the shadow props, Android reads
 * `elevation`, so both are set. Every raised surface must also have an opaque
 * background or Android will not draw the shadow at all.
 */
export interface Shadow {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

interface ShadowSpec {
  o: number;
  r: number;
  y: number;
  e: number;
}

export function shadow(level: 0 | 1 | 2 | 3, dark = false): Shadow {
  const specs: [ShadowSpec, ShadowSpec, ShadowSpec, ShadowSpec] = [
    { o: 0, r: 0, y: 0, e: 0 },
    { o: dark ? 0.32 : 0.08, r: 0, y: 2, e: 2 },
    { o: dark ? 0.4 : 0.12, r: 1, y: 3, e: 5 },
    { o: dark ? 0.5 : 0.18, r: 2, y: 5, e: 12 },
  ];
  const spec = specs[level];
  return {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: spec.y },
    shadowOpacity: spec.o,
    shadowRadius: spec.r,
    elevation: spec.e,
  };
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
  const isDark = isDarkScheme(preference, scheme);
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
