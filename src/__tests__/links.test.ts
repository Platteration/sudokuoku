import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_CODE_LENGTH, challengeCodeFromUrl, clearChallengeLinkFromUrl } from '../app/links';
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

  it('reads the query form a static host also answers for the page', () => {
    expect(challengeCodeFromUrl(`https://platteration.github.io/sudokuoku/?/c/${code}`)).toBe(code);
    expect(challengeCodeFromUrl(`http://127.0.0.1:8081/?/c/${code}#top`)).toBe(code);
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

  it('replaces a challenge hash with the bare app path and query', () => {
    const replaceState = fakeWindow(`#/c/${code}`, '/sudokuoku/', '?lang=en');
    expect(clearChallengeLinkFromUrl()).toBe(true);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://host/sudokuoku/?lang=en');
  });

  it('takes the query and path forms out as well, keeping what else the address holds', () => {
    const fromQuery = fakeWindow('#top', '/sudokuoku/', `?/c/${code}`);
    expect(clearChallengeLinkFromUrl()).toBe(true);
    expect(fromQuery).toHaveBeenCalledWith(null, '', 'https://host/sudokuoku/#top');
    const fromPath = fakeWindow('', `/sudokuoku/c/${code}`);
    expect(clearChallengeLinkFromUrl()).toBe(true);
    expect(fromPath).toHaveBeenCalledWith(null, '', 'https://host/sudokuoku/');
  });

  it('leaves the address alone when it carries no challenge', () => {
    const replaceState = fakeWindow('');
    expect(clearChallengeLinkFromUrl()).toBe(false);
    const unrelated = fakeWindow('#settings');
    expect(clearChallengeLinkFromUrl()).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
    expect(unrelated).not.toHaveBeenCalled();
  });

  it('survives a window without history, and a browser that refuses the rewrite', () => {
    const location = { hash: `#/c/${code}`, pathname: '/', search: '', href: `https://host/#/c/${code}` };
    vi.stubGlobal('window', { location });
    expect(clearChallengeLinkFromUrl()).toBe(false);
    const replaceState = vi.fn(() => {
      throw new Error('SecurityError');
    });
    vi.stubGlobal('window', { location, history: { replaceState } });
    expect(clearChallengeLinkFromUrl()).toBe(false);
    expect(replaceState).toHaveBeenCalledTimes(1);
  });
});
