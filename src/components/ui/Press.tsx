import React, { useCallback, useRef } from 'react';
import {
  Animated,
  GestureResponderEvent,
  Platform,
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** How far the control shrinks while held. */
  scaleTo?: number;
  children: React.ReactNode;
}

/**
 * A Pressable that dips slightly while held. Every button in the app is built
 * on this, so the whole interface answers a touch the same way. The scale runs
 * on the native driver, so it stays smooth while the board is animating.
 * Layout behaves exactly like a plain Pressable: the transform is the only
 * thing added.
 */
export default function Press({ style, scaleTo = 0.95, children, ...rest }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const { onPressIn, onPressOut, disabled } = rest;

  const spring = useCallback(
    (to: number) => {
      Animated.spring(scale, {
        toValue: to,
        useNativeDriver: true,
        speed: 40,
        bounciness: 4,
      }).start();
    },
    [scale],
  );

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      if (!disabled) spring(scaleTo);
      onPressIn?.(e);
    },
    [disabled, spring, scaleTo, onPressIn],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      spring(1);
      onPressOut?.(e);
    },
    [spring, onPressOut],
  );

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, { transform: [{ scale }] }]}
      android_ripple={Platform.OS === 'android' ? { color: '#00000014' } : undefined}
    >
      {children}
    </AnimatedPressable>
  );
}
