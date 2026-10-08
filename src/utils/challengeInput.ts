/**
 * The challenge code in whatever a player pasted into the challenge sheet: a
 * bare code, a link (`sudokuoku://c/<code>`), or a link carrying the code as
 * `?code=`. What comes back still goes through decodeChallenge, which refuses
 * anything that is not a code.
 *
 * The text is not the app's: Paste from clipboard reads whatever is there,
 * of any length, and a page can put anything there when its text is copied.
 * So every step here is one pass over it.
 */
export function parseChallengeInput(raw: string): string {
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
  return withoutQuery(afterSlash);
}

/**
 * `text` without its last line's query or fragment: cut at the first `?` or
 * `#` after the last line break. That is what `text.replace(/[?#].*$/, '')`
 * did, since `.` stops at a line break and `$` is the end of the text, but the
 * pattern found it by trying every `?` in turn, each one walking to the next
 * line break and back before failing: quadratic in the text. A pasted run of
 * 100,000 `?` and a second line held the page for 13 seconds in Chromium, and
 * the time grows with the square of the length.
 */
function withoutQuery(text: string): string {
  const lastBreak = Math.max(
    text.lastIndexOf('\n'),
    text.lastIndexOf('\r'),
    text.lastIndexOf('\u2028'),
    text.lastIndexOf('\u2029'),
  );
  for (let i = lastBreak + 1; i < text.length; i++) {
    if (text[i] === '?' || text[i] === '#') return text.slice(0, i);
  }
  return text;
}
