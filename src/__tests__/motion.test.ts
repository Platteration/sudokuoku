import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * React Native, reduced to the two things the motion module reads: which
 * platform this is, and the accessibility service's answer about motion.
 */
const rn = vi.hoisted(() => ({
  os: 'ios' as string,
  answer: Promise.resolve(false) as Promise<boolean>,
  listeners: [] as ((reduced: boolean) => void)[],
  removed: 0,
}));
vi.mock('react-native', () => ({
  Platform: { get OS() { return rn.os; } },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => rn.answer,
    addEventListener: (_event: string, handler: (reduced: boolean) => void) => {
      rn.listeners.push(handler);
      return {
        remove: () => {
          rn.listeners = rn.listeners.filter((h) => h !== handler);
          rn.removed += 1;
        },
      };
    },
  },
}));

const { resolveReduceMotion, watchSystemReduceMotion } = await import('../motion');

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A browser's `matchMedia`, with the one query the module asks for. */
function fakeMatchMedia(matches: boolean) {
  const handlers: ((e: { matches: boolean }) => void)[] = [];
  const media = {
    matches,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => handlers.push(fn),
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
      handlers.splice(handlers.indexOf(fn), 1);
    },
    /** Flip the OS preference, as the change event reports it. */
    set(next: boolean) {
      media.matches = next;
      handlers.forEach((fn) => fn({ matches: next }));
    },
    handlers,
  };
  const queries: string[] = [];
  (globalThis as { window?: unknown }).window = {
    matchMedia: (q: string) => {
      queries.push(q);
      return media;
    },
  };
  return { media, queries };
}

beforeEach(() => {
  rn.os = 'ios';
  rn.answer = Promise.resolve(false);
  rn.listeners = [];
  rn.removed = 0;
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('resolving the three-way setting', () => {
  it('is the setting when it is on or off, and the system when it is system', () => {
    expect(resolveReduceMotion('on', false)).toBe(true);
    expect(resolveReduceMotion('off', true)).toBe(false);
    expect(resolveReduceMotion('system', true)).toBe(true);
    expect(resolveReduceMotion('system', false)).toBe(false);
  });
});

describe('following the device on native', () => {
  it('reports the answer and every change until unsubscribed', async () => {
    rn.answer = Promise.resolve(true);
    const seen: boolean[] = [];
    const stop = watchSystemReduceMotion((v) => seen.push(v));
    await flush();
    expect(seen).toEqual([true]);
    rn.listeners.forEach((h) => h(false));
    expect(seen).toEqual([true, false]);
    stop();
    expect(rn.removed).toBe(1);
    rn.listeners.forEach((h) => h(true));
    expect(seen).toEqual([true, false]);
  });

  it('means no preference when the native module is absent', async () => {
    // AccessibilityInfo.isReduceMotionEnabled rejects, rather than resolving
    // false, when nothing native is there to ask: under a test renderer, for
    // one. That is not an error and must not be one here.
    rn.answer = Promise.reject(new Error('native module missing'));
    const seen: boolean[] = [];
    watchSystemReduceMotion((v) => seen.push(v));
    await flush();
    expect(seen).toEqual([false]);
  });

  it('drops an answer that arrives after unsubscribing', async () => {
    let resolve!: (v: boolean) => void;
    rn.answer = new Promise((r) => (resolve = r));
    const seen: boolean[] = [];
    const stop = watchSystemReduceMotion((v) => seen.push(v));
    stop();
    resolve(true);
    await flush();
    expect(seen).toEqual([]);
  });
});

describe('following the browser on the web', () => {
  it('reads prefers-reduced-motion and follows its changes', () => {
    rn.os = 'web';
    const { media, queries } = fakeMatchMedia(true);
    const seen: boolean[] = [];
    const stop = watchSystemReduceMotion((v) => seen.push(v));
    expect(queries).toEqual(['(prefers-reduced-motion: reduce)']);
    expect(seen).toEqual([true]);
    media.set(false);
    expect(seen).toEqual([true, false]);
    stop();
    expect(media.handlers).toEqual([]);
    media.set(true);
    expect(seen).toEqual([true, false]);
  });

  it('means no preference when the page has no matchMedia', () => {
    // react-native-web's own AccessibilityInfo resolves *true* here, and its
    // listener returns nothing to remove; a page that cannot be asked has
    // not asked for anything.
    rn.os = 'web';
    (globalThis as { window?: unknown }).window = {};
    const seen: boolean[] = [];
    const stop = watchSystemReduceMotion((v) => seen.push(v));
    expect(seen).toEqual([false]);
    expect(() => stop()).not.toThrow();
    // ...and with no window at all, the same.
    delete (globalThis as { window?: unknown }).window;
    const again: boolean[] = [];
    watchSystemReduceMotion((v) => again.push(v));
    expect(again).toEqual([false]);
    expect(rn.listeners).toEqual([]); // never went near the native path
  });
});
