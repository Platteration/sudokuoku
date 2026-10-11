import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CODE_LENGTH,
  challengeCodeFromUrl,
  clearChallengeLinkFromUrl,
  decideChallengeLink,
} from '../app/links';
import {
  CHALLENGE_FORMAT,
  Challenge,
  ENGINE_REVISION,
  PRESETS,
  decodeChallenge,
  encodeChallenge,
} from '../engine';

const challenge: Challenge = {
  format: CHALLENGE_FORMAT,
  engine: ENGINE_REVISION,
  seed: 3790095737,
  difficulty: 'hard',
  rules: PRESETS.find((p) => p.id === 'classic')!.rules,
};
const code = encodeChallenge(challenge);

describe('challengeCodeFromUrl', () => {
  it('reads the web hash form, with the host and repository path intact', () => {
    expect(challengeCodeFromUrl(`https://platteration.github.io/sudokuoku/#/c/${code}`)).toBe(code);
    expect(challengeCodeFromUrl(`http://127.0.0.1:5174/#/c/${code}`)).toBe(code);
  });

  it('reads the native scheme form', () => {
    expect(challengeCodeFromUrl(`sudokuoku://c/${code}`)).toBe(code);
  });

  it('reads the older path form', () => {
    expect(challengeCodeFromUrl(`https://sudokuoku.app/c/${code}`)).toBe(code);
    expect(challengeCodeFromUrl(`https://sudokuoku.app/c/${code}?utm=x`)).toBe(code);
  });

  it('prefers the hash when the path also contains /c/', () => {
    expect(challengeCodeFromUrl(`https://host/c/old#/c/${code}`)).toBe(code);
  });

  it('hands decodeChallenge a code it accepts', () => {
    const fromLink = challengeCodeFromUrl(`https://host/app/#/c/${encodeURIComponent(code)}`);
    expect(fromLink).toBe(code);
    const result = decodeChallenge(fromLink!);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.challenge.seed).toBe(challenge.seed);
  });

  it('percent-decodes, and keeps a code whose escapes are malformed', () => {
    expect(challengeCodeFromUrl('sudokuoku://c/AQ%2D_x')).toBe('AQ-_x');
    expect(challengeCodeFromUrl('sudokuoku://c/AQ%E0%A4%A')).toBe('AQ%E0%A4%A');
  });

  it('returns null for a URL without a code', () => {
    expect(challengeCodeFromUrl(null)).toBeNull();
    expect(challengeCodeFromUrl(undefined)).toBeNull();
    expect(challengeCodeFromUrl('')).toBeNull();
    expect(challengeCodeFromUrl('https://platteration.github.io/sudokuoku/')).toBeNull();
    expect(challengeCodeFromUrl('https://host/#/c/')).toBeNull();
    expect(challengeCodeFromUrl('sudokuoku://daily')).toBeNull();
  });

  it('refuses a code longer than the codec could ever produce', () => {
    const long = 'A'.repeat(MAX_CODE_LENGTH + 1);
    expect(challengeCodeFromUrl(`sudokuoku://c/${long}`)).toBeNull();
    expect(challengeCodeFromUrl(`sudokuoku://c/${'A'.repeat(MAX_CODE_LENGTH)}`)).toHaveLength(
      MAX_CODE_LENGTH,
    );
  });
});

describe('decideChallengeLink', () => {
  const other = encodeChallenge({ ...challenge, seed: 12345 });

  it('starts a code the app holds nothing for', () => {
    expect(decideChallengeLink(code, null, false)).toBe('start');
  });

  it('resumes the attempt already saved for the same code instead of restarting it', () => {
    expect(decideChallengeLink(code, { code, status: 'playing' }, false)).toBe('resume');
    expect(decideChallengeLink(code, { code, status: 'playing' }, true)).toBe('resume');
  });

  it('shows a finished attempt for the same code rather than starting a second one', () => {
    expect(decideChallengeLink(code, { code, status: 'won' }, false)).toBe('finished');
    expect(decideChallengeLink(code, { code, status: 'won' }, true)).toBe('finished');
  });

  it('starts a different code even while another challenge is held', () => {
    expect(decideChallengeLink(other, { code, status: 'playing' }, false)).toBe('start');
    expect(decideChallengeLink(other, { code, status: 'won' }, false)).toBe('start');
  });

  it('ignores a code this session already consumed once its attempt is gone', () => {
    expect(decideChallengeLink(code, null, true)).toBe('ignore');
    expect(decideChallengeLink(code, { code: other, status: 'playing' }, true)).toBe('ignore');
  });

  it('compares the canonical code, so a re-encoded saved challenge still matches', () => {
    const decoded = decodeChallenge(code);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const held = { code: encodeChallenge(decoded.challenge), status: 'playing' as const };
    expect(decideChallengeLink(code, held, false)).toBe('resume');
  });
});

describe('clearChallengeLinkFromUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeWindow(hash: string, pathname = '/sudokuoku/', search = '') {
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: { hash, pathname, search, href: `https://host${pathname}${search}${hash}` },
      history: { replaceState, state: null },
    });
    return replaceState;
  }

  it('does nothing without a window, as on a device or under node', () => {
    expect(typeof window).toBe('undefined');
    expect(clearChallengeLinkFromUrl()).toBe(false);
  });

  it('replaces a consumed challenge hash with the bare app path and query', () => {
    const replaceState = fakeWindow(`#/c/${code}`, '/sudokuoku/', '?lang=en');
    expect(clearChallengeLinkFromUrl()).toBe(true);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/sudokuoku/?lang=en');
  });

  it('leaves the address alone when it carries no challenge', () => {
    const replaceState = fakeWindow('');
    expect(clearChallengeLinkFromUrl()).toBe(false);
    const unrelated = fakeWindow('#settings');
    expect(clearChallengeLinkFromUrl()).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
    expect(unrelated).not.toHaveBeenCalled();
  });

  it('survives a window without history', () => {
    vi.stubGlobal('window', { location: { hash: `#/c/${code}`, pathname: '/', search: '' } });
    expect(clearChallengeLinkFromUrl()).toBe(false);
    vi.stubGlobal('window', {
      location: { hash: `#/c/${code}`, pathname: '/', search: '' },
      history: {
        replaceState: () => {
          throw new Error('SecurityError');
        },
      },
    });
    expect(clearChallengeLinkFromUrl()).toBe(false);
  });
});
