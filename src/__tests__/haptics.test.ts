import { beforeEach, describe, expect, it, vi } from 'vitest';

const rn = vi.hoisted(() => ({ os: 'ios' as string, calls: [] as string[] }));
vi.mock('react-native', () => ({ Platform: { get OS() { return rn.os; } } }));
vi.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
  impactAsync: async (style: string) => {
    rn.calls.push(`impact:${style}`);
  },
  notificationAsync: async (type: string) => {
    rn.calls.push(`notification:${type}`);
  },
  selectionAsync: async () => {
    rn.calls.push('selection');
  },
}));

const { haptic, setHapticsEnabled } = await import('../haptics');

beforeEach(() => {
  rn.os = 'ios';
  rn.calls = [];
  setHapticsEnabled(true);
});

describe('the vibration switch', () => {
  it('gates every haptic through one module flag', () => {
    haptic('tap');
    haptic('shift');
    haptic('win');
    expect(rn.calls).toEqual(['selection', 'impact:medium', 'notification:success']);
    setHapticsEnabled(false);
    haptic('tap');
    haptic('shift');
    haptic('win');
    expect(rn.calls).toHaveLength(3);
    setHapticsEnabled(true);
    haptic('tap');
    expect(rn.calls).toHaveLength(4);
  });

  it('never reaches the module on the web', () => {
    rn.os = 'web';
    haptic('win');
    expect(rn.calls).toEqual([]);
  });
});
