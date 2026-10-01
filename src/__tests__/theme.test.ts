import { describe, expect, it } from 'vitest';
import { isDarkScheme } from '../palette';

describe('which palette applies', () => {
  it('is the preference when one is stated', () => {
    for (const system of ['light', 'dark', null, undefined]) {
      expect(isDarkScheme('dark', system)).toBe(true);
      expect(isDarkScheme('light', system)).toBe(false);
    }
  });

  it('follows the system, and a system that states nothing means dark', () => {
    // React Native types the scheme as possibly null: the OS stated no
    // preference. Every sibling app resolves that to its own pre-provider
    // default, which is dark; this app's used to be the one exception.
    expect(isDarkScheme('system', 'light')).toBe(false);
    expect(isDarkScheme('system', 'dark')).toBe(true);
    expect(isDarkScheme('system', null)).toBe(true);
    expect(isDarkScheme('system', undefined)).toBe(true);
    expect(isDarkScheme('system', 'unspecified')).toBe(true);
  });
});
