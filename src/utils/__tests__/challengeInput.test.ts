import { describe, expect, it } from 'vitest';
import { parseChallengeInput } from '../challengeInput';

/** The parser as it was written with a pattern, kept as the reference for what it answers. */
function reference(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const fromQuery = /[?&#]code=([^&#]+)/.exec(trimmed);
  const fromQueryCode = fromQuery?.[1];
  if (fromQueryCode !== undefined) {
    try {
      return decodeURIComponent(fromQueryCode);
    } catch {
      return fromQueryCode;
    }
  }
  const afterSlash = trimmed.lastIndexOf('/') >= 0 ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed;
  return afterSlash.replace(/[?#].*$/, '');
}

describe('reading a pasted challenge', () => {
  const CODE = 'AQH_6putX8SjK4Ch';

  it('finds the code in a bare code, a link, and a link with a query or fragment', () => {
    expect(parseChallengeInput(`  ${CODE}\n`)).toBe(CODE);
    expect(parseChallengeInput(`sudokuoku://c/${CODE}`)).toBe(CODE);
    expect(parseChallengeInput(`sudokuoku://c/${CODE}?from=chat#top`)).toBe(CODE);
    expect(parseChallengeInput(`https://example.org/play?code=${CODE}&x=1`)).toBe(CODE);
    expect(parseChallengeInput(`https://example.org/play#code=${encodeURIComponent(CODE)}`)).toBe(CODE);
    expect(parseChallengeInput('   ')).toBe('');
  });

  it('answers what the pattern it replaced answered, line breaks included', () => {
    // Every string of up to four characters over the ones that matter, then longer random ones.
    const alphabet = ['a', '?', '#', '/', '\n', '\r', '\u2028', '\u2029', ' ', '&', '='];
    const strings: string[] = [''];
    for (let length = 1; length <= 4; length++) {
      for (const s of strings.filter((x) => x.length === length - 1)) {
        for (const ch of alphabet) strings.push(s + ch);
      }
    }
    let seed = 12345;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    for (let i = 0; i < 20000; i++) {
      let s = '';
      for (let n = next() % 24; n > 0; n--) s += alphabet[next() % alphabet.length]!;
      strings.push(`${next() % 2 ? 'code=' : ''}${s}`);
    }
    for (const s of strings) expect(parseChallengeInput(s), JSON.stringify(s)).toBe(reference(s));
  });

  it('reads a long paste in one pass, whatever is in it', () => {
    // The clipboard can hold anything. The pattern this replaced was quadratic on a run of `?`
    // with a line after it: 40,000 of them took seconds, 100,000 held a browser tab for 13.
    const n = 40000;
    for (const text of [
      `${'?'.repeat(n)}\nx`,
      `${'#'.repeat(n)}\u2028x`,
      `${'?a'.repeat(n)}\r\nx`,
      '?code='.repeat(n),
      '&code'.repeat(n),
      `sudokuoku://c/${'?'.repeat(n)}\nx`,
    ]) {
      const start = performance.now();
      parseChallengeInput(text);
      expect(performance.now() - start, JSON.stringify(text.slice(0, 12))).toBeLessThan(250);
    }
  });
});
