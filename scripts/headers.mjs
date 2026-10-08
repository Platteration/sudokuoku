/**
 * Reading a `_headers` file the way Netlify and Cloudflare Pages read it. The build takes the
 * pages' Content-Security-Policy <meta> from it, the end-to-end host sends what it says, and the
 * unit suite holds the other hosts' configs to it, so all three read it through this one module.
 */

/**
 * The rules of a `_headers` file: `[{ path, headers: [[name, value]] }]`, in file order. A rule
 * is a line that starts with `/`; its headers are the indented `Name: value` lines below it.
 */
export function parseHeaders(text) {
  /** @type {{ path: string, headers: [string, string][] }[]} */
  const rules = [];
  for (const [i, line] of text.split('\n').entries()) {
    if (/^\s*(#|$)/.test(line)) continue;
    if (line.startsWith('/')) {
      rules.push({ path: line.trim(), headers: [] });
      continue;
    }
    const header = /^\s+([A-Za-z0-9-]+):\s*(.*?)\s*$/.exec(line);
    const rule = rules[rules.length - 1];
    if (!header || !rule) throw new Error(`_headers line ${i + 1} is neither a path nor a header: ${line}`);
    rule.headers.push([header[1], header[2]]);
  }
  return rules;
}

/** Whether a `_headers` path pattern matches a path; `*` matches anything, slashes included. */
export function pathMatches(pattern, path) {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(path);
}

/**
 * The headers `rules` give a path, by lower-case name. Two matching rules that set one header
 * have their values joined, as Cloudflare Pages joins them; `duplicates` names any such header
 * so a test can refuse it, since what a host makes of two values is not this site's to rely on.
 */
export function headersFor(rules, path) {
  /** @type {Record<string, string>} */
  const headers = {};
  /** @type {string[]} */
  const duplicates = [];
  for (const rule of rules) {
    if (!pathMatches(rule.path, path)) continue;
    for (const [name, value] of rule.headers) {
      const key = name.toLowerCase();
      if (key in headers) {
        duplicates.push(name);
        headers[key] = `${headers[key]}, ${value}`;
      } else headers[key] = value;
    }
  }
  return { headers, duplicates };
}

/**
 * The policy for a page's <meta>: what `_headers` sends every response, less two directives.
 * `frame-ancestors`, which a <meta> cannot carry (browsers ignore it there and say so in the
 * console). And `upgrade-insecure-requests`, which a <meta> can carry but should not: every
 * address the pages load is the site's own, so on https it changes nothing, and on a plain-http
 * page that is not localhost (a LAN preview of dist/, a host before its certificate) it sent
 * guard.js and the bundle to https on a port that speaks http: both failed, and the visitor got
 * a blank page with no note, the safety net having been the first thing refused. Every host
 * config that sends the header also redirects http to https, so the header copies keep it.
 */
export function metaPolicy(headersText) {
  const every = parseHeaders(headersText).filter((rule) => rule.path === '/*');
  const policy = every.length === 1 ? every[0].headers.find(([name]) => name === 'Content-Security-Policy')?.[1] : undefined;
  if (!policy) throw new Error('_headers sets no Content-Security-Policy for /*');
  return policy
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/^(frame-ancestors|upgrade-insecure-requests)\b/.test(d))
    .join('; ');
}
