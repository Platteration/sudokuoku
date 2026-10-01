import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rn = vi.hoisted(() => ({
  os: 'ios' as string,
  alerts: [] as unknown[][],
}));
vi.mock('react-native', () => ({
  Platform: { get OS() { return rn.os; } },
  Alert: {
    alert: (...args: unknown[]) => {
      rn.alerts.push(args);
    },
  },
}));

const { confirmAction } = await import('../confirm');

type Button = { text: string; style: string; onPress?: () => void };

const ask = (onConfirm: () => void) =>
  confirmAction({
    title: 'Reset progress?',
    message: 'This cannot be undone.',
    cancelLabel: 'Keep',
    confirmLabel: 'Reset',
    onConfirm,
  });

beforeEach(() => {
  rn.os = 'ios';
  rn.alerts = [];
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('confirming on a device', () => {
  it('asks with two buttons, cancel first and safe, the verb on the destructive one', () => {
    const confirmed = vi.fn();
    ask(confirmed);
    expect(rn.alerts).toHaveLength(1);
    const [title, message, buttons] = rn.alerts[0] as [string, string, Button[]];
    expect(title).toBe('Reset progress?');
    expect(message).toBe('This cannot be undone.');
    expect(buttons.map((b) => [b.text, b.style])).toEqual([
      ['Keep', 'cancel'],
      ['Reset', 'destructive'],
    ]);
    expect(buttons[0]!.onPress).toBeUndefined();
    expect(confirmed).not.toHaveBeenCalled();
    buttons[1]!.onPress!();
    expect(confirmed).toHaveBeenCalledTimes(1);
  });
});

describe('confirming on the web', () => {
  it('uses the browser dialog, because Alert.alert is a no-op there', () => {
    // react-native-web: `class Alert { static alert() {} }`. A confirmation
    // built on it silently never confirms, and the button it guards looks
    // broken. The browser's own dialog is the answer on that platform.
    rn.os = 'web';
    const asked: string[] = [];
    let answer = true;
    (globalThis as { window?: unknown }).window = {
      confirm: (text: string) => {
        asked.push(text);
        return answer;
      },
    };
    const confirmed = vi.fn();
    ask(confirmed);
    expect(rn.alerts).toEqual([]);
    expect(asked).toEqual(['Reset progress?\n\nThis cannot be undone.']);
    expect(confirmed).toHaveBeenCalledTimes(1);
    answer = false;
    ask(confirmed);
    expect(confirmed).toHaveBeenCalledTimes(1);
  });

  it('does nothing destructive when there is no window to ask', () => {
    rn.os = 'web';
    const confirmed = vi.fn();
    expect(() => ask(confirmed)).not.toThrow();
    expect(confirmed).not.toHaveBeenCalled();
    expect(rn.alerts).toEqual([]);
  });
});
