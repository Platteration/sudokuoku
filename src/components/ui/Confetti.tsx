import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';

interface Props {
  /** Restarts the burst whenever this changes. */
  runKey: number | string;
  width: number;
  active: boolean;
  reduceMotion?: boolean;
}

const COUNT = 22;

/**
 * A short confetti burst for a win. One Animated.Value drives every piece and
 * each interpolates it differently, so the whole effect costs a single native
 * animation rather than twenty-two of them.
 */
export default function Confetti({ runKey, width, active, reduceMotion }: Props) {
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;

  const pieces = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => {
        // Deterministic scatter, so a re-render never reshuffles mid-flight.
        const r = (n: number) => ((Math.sin((i + 1) * n) + 1) / 2);
        return {
          key: i,
          left: r(12.9898) * width,
          drift: (r(78.233) - 0.5) * 90,
          delay: r(43.758) * 0.35,
          size: 6 + r(93.989) * 7,
          spin: r(11.17) > 0.5 ? 1 : -1,
          color: [colors.primary, colors.accent, colors.success, colors.phantom][i % 4],
        };
      }),
    [width, colors],
  );

  useEffect(() => {
    if (!active || reduceMotion) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 2200,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [runKey, active, reduceMotion, progress]);

  if (!active || reduceMotion) return null;

  return (
    <View pointerEvents="none" style={styles.layer}>
      {pieces.map((p) => {
        // Each piece starts a little later, so the burst arrives in waves.
        const span = [p.delay, Math.min(1, p.delay + 0.65)];
        return (
          <Animated.View
            key={p.key}
            style={[
              styles.piece,
              {
                left: p.left,
                width: p.size,
                height: p.size * 0.55,
                backgroundColor: p.color,
                opacity: progress.interpolate({
                  inputRange: [span[0], span[0] + 0.05, span[1] - 0.2, span[1]],
                  outputRange: [0, 1, 1, 0],
                  extrapolate: 'clamp',
                }),
                transform: [
                  {
                    translateY: progress.interpolate({
                      inputRange: span,
                      outputRange: [-20, 260],
                      extrapolate: 'clamp',
                    }),
                  },
                  {
                    translateX: progress.interpolate({
                      inputRange: span,
                      outputRange: [0, p.drift],
                      extrapolate: 'clamp',
                    }),
                  },
                  {
                    rotate: progress.interpolate({
                      inputRange: span,
                      outputRange: ['0deg', `${p.spin * 540}deg`],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 300,
    overflow: 'hidden',
  },
  piece: {
    position: 'absolute',
    top: 0,
    borderRadius: 1.5,
  },
});
