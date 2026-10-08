/**
 * The website's hosting layer, read as text. The policy is written in five places — the
 * `_headers` file Netlify and Cloudflare Pages read, Apache's `.htaccess`, `deploy/nginx.conf`,
 * the `<meta>` in both pages for a host that sends no headers, and the README — and a value
 * changed in one of them and not the others is a site that behaves differently on each host.
 * The same goes for the rules that keep the hosting files and the repository's own files off
 * the site, and for the cache rules. `npm run test:e2e` is where the policy is measured against
 * the running app; this is where the copies are held to each other.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OUT_FOLDERS, withBase, withPolicy } from '../../scripts/build-web.mjs';
import { headersFor, metaPolicy, parseHeaders } from '../../scripts/headers.mjs';
import { SOURCE_URL } from '../about';
import { darkColors, lightColors } from '../palette';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const SECURITY_HEADERS = [
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Cross-Origin-Opener-Policy',
  'Cross-Origin-Resource-Policy',
  'Strict-Transport-Security',
];

/** The headers every response carries, from the `/*` rule of public/_headers. */
function fromHeadersFile(): Record<string, string> {
  const all = parseHeaders(read('public/_headers')).filter((rule) => rule.path === '/*');
  expect(all).toHaveLength(1);
  return Object.fromEntries(all[0]!.headers); // the one rule just counted
}

/** Apache's `Header always set Name "value"` lines that hold for every response. */
function fromHtaccess(): Record<string, string> {
  const text = read('public/.htaccess').replace(/<If [\s\S]*?<\/Else>/, '');
  return Object.fromEntries([...text.matchAll(/^\s*Header always set ([\w-]+) "([^"]*)"\s*$/gm)].map((m) => [m[1]!, m[2]!]));
}

/** A directive of nginx's configuration: its name, its arguments, and the block it opens, if any. */
interface NginxDirective {
  name: string;
  args: string[];
  block?: NginxDirective[];
}

/**
 * nginx's configuration as nginx reads it: words and quoted strings (where a backslash before a
 * quote or a backslash keeps that character, and any other backslash stays), `#` comments, and
 * `;` and braces ending a directive or opening and closing a block. Read line by line, a header
 * in a location looks like one at server level, and nginx treats them very differently: a
 * location that adds any header of its own inherits none of the server's.
 */
function parseNginx(text: string): NginxDirective[] {
  const tokens: { text: string; punct: boolean }[] = [];
  for (let i = 0; i < text.length; ) {
    const c = text[i]!;
    if (/\s/.test(c)) i += 1;
    else if (c === '#') while (i < text.length && text[i] !== '\n') i += 1;
    else if (c === ';' || c === '{' || c === '}') {
      tokens.push({ text: c, punct: true });
      i += 1;
    } else if (c === '"' || c === "'") {
      let word = '';
      for (i += 1; i < text.length && text[i] !== c; i += 1) {
        if (text[i] === '\\' && (text[i + 1] === c || text[i + 1] === '\\')) i += 1;
        word += text[i];
      }
      expect(i < text.length, 'every quoted string is closed').toBe(true);
      tokens.push({ text: word, punct: false });
      i += 1;
    } else {
      let word = '';
      while (i < text.length && !/[\s;{}]/.test(text[i]!)) word += text[i++];
      tokens.push({ text: word, punct: false });
    }
  }
  let at = 0;
  const block = (depth: number): NginxDirective[] => {
    const out: NginxDirective[] = [];
    let words: string[] = [];
    while (at < tokens.length) {
      const token = tokens[at++]!; // the loop condition bounds it
      if (!token.punct) {
        words.push(token.text);
        continue;
      }
      if (token.text === '}') {
        expect(words, 'a directive before a closing brace ends with ;').toEqual([]);
        expect(depth, 'a closing brace closes a block').toBeGreaterThan(0);
        return out;
      }
      const [name, ...args] = words;
      expect(name, `a ${token.text} follows a directive`).toBeDefined();
      words = [];
      out.push(token.text === '{' ? { name: name!, args, block: block(depth + 1) } : { name: name!, args });
    }
    expect(words, 'the last directive ends with ;').toEqual([]);
    expect(depth, 'every block is closed').toBe(0);
    return out;
  };
  return block(0);
}

const nginxConf = () => parseNginx(read('deploy/nginx.conf'));

/** The server that answers https, the only one that serves the site: the one listening with ssl. */
function tlsServer(conf: NginxDirective[]): NginxDirective[] {
  const servers = conf.filter((d) => d.name === 'server' && d.block?.some((l) => l.name === 'listen' && l.args.includes('ssl')));
  expect(servers).toHaveLength(1);
  return servers[0]!.block!; // the length was just checked, and a server is a block
}

/** Every directive in `directives` and in the blocks below them, each with the block it sits in. */
function everyDirective(directives: NginxDirective[]): { directive: NginxDirective; parent: NginxDirective[] }[] {
  return directives.flatMap((directive) => [{ directive, parent: directives }, ...(directive.block ? everyDirective(directive.block) : [])]);
}

/** nginx's headers with a literal value: the https server's own `add_header`s. */
function fromNginx(): Record<string, string> {
  const headers = tlsServer(nginxConf()).filter((d) => d.name === 'add_header' && !d.args[1]!.startsWith('$'));
  return Object.fromEntries(headers.map((d) => [d.args[0]!, d.args[1]!]));
}

/**
 * What nginx answers an address with, by its locations: an exact location first, then the first
 * regular expression that matches in file order, then the longest prefix. `served` means the file
 * is sent if it exists; a number is the status a location returns (`internal` is a 404 from outside).
 */
function nginxAnswer(server: NginxDirective[], uri: string): 'served' | number {
  const locations = server.filter((d) => d.name === 'location');
  const exact = locations.find((l) => l.args[0] === '=' && l.args[1] === uri);
  const regex = locations.find((l) => l.args[0] === '~' && new RegExp(l.args[1]!).test(uri));
  const prefix = locations.filter((l) => l.args.length === 1 && uri.startsWith(l.args[0]!)).sort((a, b) => b.args[0]!.length - a.args[0]!.length)[0];
  const chosen = exact ?? regex ?? prefix;
  if (!chosen) return 404;
  if (chosen.block!.some((d) => d.name === 'internal')) return 404;
  const returned = chosen.block!.find((d) => d.name === 'return');
  return returned ? Number(returned.args[0]) : 'served';
}

/**
 * What Apache answers an address with, by .htaccess's rewrite rules in order: a rule fires when
 * its pattern matches the address without its leading slash (or, after `!`, does not) and every
 * condition just before it holds. `served` means no rule fired. Only the conditions the file
 * uses are known here, so a new kind of condition fails the test rather than being guessed at.
 */
function apacheAnswer(conf: string, uri: string, https = true): 'served' | number {
  const vars = new Map([
    ['%{HTTPS}', https ? 'on' : 'off'],
    ['%{HTTP:X-Forwarded-Proto}', ''],
  ]);
  let conditions: boolean[] = [];
  for (const line of conf.split('\n').map((l) => l.trim())) {
    if (line.startsWith('RewriteCond ')) {
      const cond = /^RewriteCond (\S+) (!?=)(\S+)$/.exec(line);
      expect(cond && vars.has(cond[1]!), `a condition this test can read: ${line}`).toBe(true);
      const value = vars.get(cond![1]!); // the line was just checked
      conditions.push(cond![2] === '=' ? value === cond![3] : value !== cond![3]);
    } else if (line.startsWith('RewriteRule ')) {
      const rule = /^RewriteRule (!?)(\S+) \S+ \[(?:[^\]]*,)?R=(\d+)(?:,[^\]]*)?\]$/.exec(line);
      expect(rule, `a rule this test can read: ${line}`).not.toBeNull();
      const [, negated, pattern, status] = rule!; // the line was just checked
      const holds = conditions.every(Boolean);
      conditions = [];
      if (holds && new RegExp(pattern!).test(uri.slice(1)) !== (negated === '!')) return Number(status);
    }
  }
  return 'served';
}

/** Every file the repository tracks, at the address a server pointed at a checkout would give it. */
function tracked(): string[] {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  expect(files.length, 'git lists the repository').toBeGreaterThan(50);
  return files.map((f) => `/${f}`);
}

/** The README's copy: the `Name: value` lines of its fenced block of response headers. */
function fromReadme(): Record<string, string> {
  const block = /```text\n((?:[\w-]+: .*\n)+)```/.exec(read('README.md'));
  expect(block, 'README.md lists the response headers in a ```text block').not.toBeNull();
  return Object.fromEntries(block![1]!.trim().split('\n').map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)]));
}

function meta(html: string, name: RegExp): string {
  const m = new RegExp(`<meta ${name.source} content="([^"]*)" />`).exec(html);
  expect(m, `the page has the <meta>`).not.toBeNull();
  return m![1]!;
}
const metaReferrer = (file: string) => meta(read(file), /name="referrer"/);

/** A policy as directive -> sources, in order. */
function directives(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    expect(out.has(name), `${name} appears once`).toBe(false);
    out.set(name, sources);
  }
  return out;
}

const PAGES = ['public/index.html', 'public/404.html'];
/** A page that already has a policy: the build must not add a second, which would intersect. */
const pageWithOwnPolicy = () => '<meta charset="utf-8" />\n<meta http-equiv="Content-Security-Policy" content="default-src *" />';

describe('the policy', () => {
  const header = fromHeadersFile();

  it('is written the same in _headers, .htaccess, nginx.conf and the README', () => {
    expect(Object.keys(header)).toEqual(SECURITY_HEADERS);
    expect(fromHtaccess()).toEqual(header);
    expect(fromNginx()).toEqual(header);
    expect(fromReadme()).toEqual(header);
  });

  it('is what the build writes into both pages, less frame-ancestors and upgrade-insecure-requests', () => {
    const csp = directives(header['Content-Security-Policy']!);
    const policy = metaPolicy(read('public/_headers'));
    // frame-ancestors, which a <meta> cannot carry; upgrade-insecure-requests, which on a plain
    // http page that is not localhost sent the safety net and the bundle to https and left a
    // blank page (npm run test:e2e loads the site that way).
    expect([...directives(policy)]).toEqual([...csp].filter(([name]) => name !== 'frame-ancestors' && name !== 'upgrade-insecure-requests'));
    expect(csp.has('upgrade-insecure-requests')).toBe(true); // the headers keep it
    for (const page of PAGES) {
      // None in the template: `npm run web` serves it too, and the dev server's reloading needs
      // what the policy refuses.
      expect(read(page), page).not.toMatch(/http-equiv="Content-Security-Policy"/i);
      const built = withPolicy(read(page), policy);
      expect(meta(built, /http-equiv="Content-Security-Policy"/), page).toBe(policy);
      expect(built.indexOf('Content-Security-Policy'), `${page}: the policy comes before anything it governs`).toBeLessThan(built.search(/<(script|style|link)\b/));
      expect(metaReferrer(page), page).toBe(header['Referrer-Policy']);
    }
    expect(() => withPolicy(pageWithOwnPolicy(), policy)).toThrow(/already carries a policy/);
    expect(() => withPolicy('<html><head></head></html>', policy)).toThrow(/exactly one/);
  });

  it('allows only what the app loads: its own scripts, styles, icon and font, and nothing else', () => {
    const csp = directives(header['Content-Security-Policy']!);
    expect(csp.get('default-src')).toEqual(["'none'"]);
    expect(csp.get('script-src')).toEqual(["'self'"]);
    // The framework writes <style> elements as it runs (react-native-web, expo-font); _headers
    // says what was measured without it.
    expect(csp.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp.get('img-src')).toEqual(["'self'"]);
    expect(csp.get('font-src')).toEqual(["'self'"]);
    expect(csp.get('connect-src')).toEqual(["'none'"]); // no network code
    for (const name of ['base-uri', 'form-action', 'object-src', 'frame-ancestors']) expect(csp.get(name), name).toEqual(["'none'"]);
    expect(csp.get('upgrade-insecure-requests')).toEqual([]);
    expect(csp.get('require-trusted-types-for')).toEqual(["'script'"]);
    expect(csp.get('trusted-types')).toEqual(["'none'"]);
    // No wildcard, no scheme, no eval, and inline only for styles.
    const sources = [...csp.values()].flat();
    expect(sources.filter((s) => /\*|:|unsafe-eval|wasm|nonce|sha/.test(s))).toEqual([]);
    expect([...csp].filter(([, s]) => s.includes("'unsafe-inline'")).map(([name]) => name)).toEqual(['style-src']);
  });

  it('turns off every browser feature but the clipboard the challenge sheet copies to and pastes from', () => {
    const features = header['Permissions-Policy']!.split(', ').map((f) => f.split('='));
    const allowed = features.filter(([, list]) => list !== '()').map((f) => f.join('='));
    expect(allowed).toEqual(['clipboard-read=(self)', 'clipboard-write=(self)']);
    for (const name of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'display-capture']) {
      expect(features.some(([f, list]) => f === name && list === '()'), name).toBe(true);
    }
  });

  it('keeps the other headers at their measured values', () => {
    expect(header['X-Content-Type-Options']).toBe('nosniff');
    expect(header['X-Frame-Options']).toBe('DENY');
    expect(header['Referrer-Policy']).toBe('no-referrer'); // a page address can carry a challenge
    expect(header['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(header['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(header['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
  });
});

describe('the pages', () => {
  it('run no inline script, no handler and no javascript: URL, so script-src stays self', () => {
    for (const page of PAGES) {
      const html = read(page);
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
      for (const [, attrs, body] of scripts) {
        expect(attrs, page).toMatch(/\bsrc="[^"]+"/);
        expect(body, page).toBe('');
      }
      expect(html, page).not.toMatch(/\son[a-z]+=/i);
      expect(html, page).not.toMatch(/javascript:/i);
    }
    // index.html loads the safety net in <head>, before Expo adds the bundle at the end of <body>.
    expect(read('public/index.html')).toMatch(/<script src="\/guard\.js"><\/script>\n {2}<\/head>/);
  });

  it('draw in the Classic pack, in pairings that meet WCAG AA', () => {
    const palette = new Set([...Object.values(lightColors), ...Object.values(darkColors)].map((c) => c.toLowerCase()));
    for (const page of PAGES) {
      const used = [...read(page).matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase());
      expect(used.filter((c) => !palette.has(c)), page).toEqual([]);
    }
    const luminance = (hex: string) => {
      const channel = (at: number) => {
        const c = parseInt(hex.slice(at, at + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    // text on the page, text and the muted line on the card, the link on the note, the button
    for (const c of [lightColors, darkColors]) {
      for (const [fg, bg] of [
        [c.text, c.background],
        [c.text, c.surface],
        [c.textMuted, c.surface],
        [c.primary, c.surface],
        [c.onPrimary, c.primary],
      ] as const) {
        expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('are written for the base path at build time', () => {
    const page = '<script src="/guard.js"></script><link rel="icon" href="/sudokuoku/favicon.ico"/><a href="">Reload</a><a href="/">Open</a><img src="//other.example/x.png">';
    expect(withBase(page, '/sudokuoku')).toBe(
      '<script src="/sudokuoku/guard.js"></script><link rel="icon" href="/sudokuoku/favicon.ico"/><a href="">Reload</a><a href="/sudokuoku/">Open</a><img src="//other.example/x.png">'
    );
    expect(withBase(page, '')).toBe(page);
  });
});

/**
 * The sample a host is asked for: every kind of file the site has, and what is not part of it —
 * the hosting configs and Expo's update manifest, which are in the published folder, folders,
 * names the site does not have, and (in the tests below) every file the repository tracks,
 * should a checkout ever be served.
 */
const SITE = [
  '/',
  '/index.html',
  '/guard.js',
  '/favicon.ico',
  '/robots.txt',
  '/.well-known/security.txt',
  '/_expo/static/js/web/index-0123456789abcdef0123456789abcdef.js',
  '/assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.0123456789abcdef0123456789abcdef.ttf',
];
/** What a webroot ACME client writes for the certificate authority to read. */
const CERTIFICATE_CHECK = '/.well-known/acme-challenge/0123abcDEF_-xyz';
const NOT_SITE = [
  '/_headers',
  '/_redirects',
  '/.htaccess',
  '/metadata.json',
  '/README.md',
  '/.git/config',
  '/.git/HEAD',
  '/deploy/nginx.conf',
  '/.env',
  '/_expo/',
  '/_expo/static/js/web/',
  '/assets/',
  '/.well-known/',
  '/.well-known/other.txt',
  '/_expo/static/js/web/index.js',
  '/assets/icon.png',
];

describe('what the hosts refuse', () => {
  it('nginx: the site and nothing else; the hosting files, folders and every file of a checkout answer 404', () => {
    const text = read('deploy/nginx.conf');
    const server = tlsServer(parseNginx(text));
    // the forms nginxAnswer knows: an exact location, a regular expression, a plain prefix, none nested
    const locations = server.filter((d) => d.name === 'location');
    expect(locations.filter((l) => !((l.args.length === 2 && ['=', '~'].includes(l.args[0]!)) || (l.args.length === 1 && l.args[0]!.startsWith('/'))))).toEqual([]);
    expect(locations.filter((l) => everyDirective(l.block!).some(({ directive }) => directive.name === 'location'))).toEqual([]);
    const answer = (p: string) => nginxAnswer(server, p);
    expect([...SITE, CERTIFICATE_CHECK].filter((p) => answer(p) !== 'served')).toEqual([]);
    expect([...NOT_SITE, ...tracked()].filter((p) => answer(p) !== 404)).toEqual([]);
    expect(answer('/404.html'), 'the 404 page is the error page, not a page of its own').toBe(404);
    // folders list nothing, a 403 shows the 404 page, and plain http is sent to https
    expect(text).toMatch(/^\s*error_page 404 \/404\.html;$/m);
    expect(text).toMatch(/^\s*error_page 403 =404 \/404\.html;$/m);
    expect(text).toMatch(/^\s*autoindex off;$/m);
    expect(text).toMatch(/^\s*server_tokens off;$/m);
    expect(text).toMatch(/^\s*return 301 https:\/\/\$host\$request_uri;$/m);
  });

  it('nginx: every header is the https server’s own, sent always, and no location adds one', () => {
    // nginx gives a location the server's add_headers only when it has none of its own: one Vary
    // in a location served its files with no policy, nosniff, HSTS or Cache-Control.
    const conf = nginxConf();
    const server = tlsServer(conf);
    const elsewhere = everyDirective(conf).filter(({ directive, parent }) => directive.name === 'add_header' && parent !== server);
    expect(elsewhere.map(({ directive }) => directive.args.join(' '))).toEqual([]);
    const headers = server.filter((d) => d.name === 'add_header');
    expect(headers.map((d) => d.args[0])).toEqual([...SECURITY_HEADERS, 'Cache-Control']);
    expect(headers.filter((d) => d.args.length !== 3 || d.args[2] !== 'always').map((d) => d.args[0])).toEqual([]); // a 404 carries them too
  });

  it('nginx: says beside `http2 on;` that it needs nginx 1.25.1, and what to write on an older one', () => {
    // Debian 12 ships nginx 1.22 and Ubuntu 24.04 1.24, where the directive stops the server reloading.
    const text = read('deploy/nginx.conf');
    expect(text).toMatch(/#[^\n]*nginx 1\.25\.1[^\n]*\n\s*http2 on;/);
    expect(text).toMatch(/^# .*`listen 443 ssl http2;`/m);
    expect(read('README.md')).toMatch(/nginx 1\.25\.1/);
  });

  it('Apache: the same addresses, by the same rules', () => {
    const conf = read('public/.htaccess');
    const answer = (p: string) => apacheAnswer(conf, p);
    expect([...SITE, '/404.html', CERTIFICATE_CHECK].filter((p) => answer(p) !== 'served')).toEqual([]);
    expect([...NOT_SITE, ...tracked()].filter((p) => answer(p) !== 404)).toEqual([]);
    // over plain http, everything is sent to https first
    expect([...SITE, ...NOT_SITE].filter((p) => apacheAnswer(conf, p, false) !== 301)).toEqual([]);
    expect(conf).toMatch(/^Options -Indexes$/m);
    expect(conf).toMatch(/^ErrorDocument 404 \/404\.html$/m);
    expect(conf).toMatch(/^ErrorDocument 403 \/404\.html$/m);
  });

  it('Netlify: the files the build publishes that are not the site, even though they exist', () => {
    const rules = read('public/_redirects')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))
      .map((l) => l.trim().split(/\s+/));
    // `404!`: Netlify does not apply a plain rule where a file exists at the path
    expect(rules.every((r) => r.length === 3 && r[1] === '/404.html' && r[2] === '404!')).toBe(true);
    expect(rules.map((r) => r[0])).toEqual(['/_headers', '/_redirects', '/.htaccess', '/metadata.json']);
  });
});

describe('caching', () => {
  const YEAR = 'public, max-age=31536000, immutable';
  const expected = (p: string) => (/^\/(_expo\/static|assets)\//.test(p) ? YEAR : 'no-cache');

  it('is a year for names that carry their content hash, and a revalidation for the rest, on every host', () => {
    const rules = parseHeaders(read('public/_headers'));
    // nginx sends what the https server's Cache-Control header names: the map of that variable.
    const conf = nginxConf();
    const variable = tlsServer(conf).find((d) => d.name === 'add_header' && d.args[0] === 'Cache-Control')?.args[1];
    expect(variable, 'the https server sends Cache-Control, from a map').toMatch(/^\$\w+$/);
    const maps = conf.filter((d) => d.name === 'map' && d.args[1] === variable);
    expect(maps.map((m) => m.args[0])).toEqual(['$uri']);
    const entries = maps[0]!.block!; // one map, just counted
    const nginx = (p: string) => (entries.find((e) => e.name.startsWith('~') && new RegExp(e.name.slice(1)).test(p)) ?? entries.find((e) => e.name === 'default'))?.args[0];
    const apacheIf = /<If "%\{REQUEST_URI\} =~ m#(.+)#">\n\s*Header always set Cache-Control "([^"]+)"\n\s*<\/If>\n\s*<Else>\n\s*Header always set Cache-Control "([^"]+)"/.exec(read('public/.htaccess'));
    expect(apacheIf).not.toBeNull();
    const apache = (p: string) => (new RegExp(apacheIf![1]!).test(p) ? apacheIf![2] : apacheIf![3]);
    for (const p of [...SITE, '/404.html']) {
      const { headers, duplicates } = headersFor(rules, p);
      expect(duplicates, p).toEqual([]); // Cloudflare Pages would join two values into one
      expect(headers['cache-control'], `_headers ${p}`).toBe(expected(p));
      expect(nginx(p), `nginx ${p}`).toBe(expected(p));
      expect(apache(p), `Apache ${p}`).toBe(expected(p));
    }
  });
});

describe('the security contact', () => {
  it('says where to report, until when, and in which language', () => {
    const fields = Object.fromEntries(
      read('public/.well-known/security.txt')
        .split('\n')
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)])
    );
    expect(fields).toEqual({
      Contact: `${SOURCE_URL}/issues`,
      Expires: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/),
      'Preferred-Languages': 'en',
      Policy: `${SOURCE_URL}/blob/HEAD/SECURITY.md`,
    });
    // RFC 9116: no more than a year ahead. Once it has passed, this fails: renew it.
    const left = Date.parse(fields.Expires!) - Date.now();
    expect(left, 'security.txt has expired: move Expires a year on').toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(366 * 24 * 3600 * 1000);
  });
});

/**
 * scripts/build-web.mjs in a sandbox of its own, with a stand-in for `expo export` that records
 * how it was called and writes what the real one writes (public/ copied, metadata.json) but
 * deletes nothing. The real exporter empties its output folder before it writes, so a guard that
 * let `--out src` through, tried against the checkout itself, would take the source with it; here
 * the worst a broken guard can do is run the stand-in.
 */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudokuoku-build-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  for (const file of ['build-web.mjs', 'headers.mjs']) fs.copyFileSync(path.join(root, 'scripts', file), path.join(repo, 'scripts', file));
  fs.cpSync(path.join(root, 'public'), path.join(repo, 'public'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'keep.ts'), 'export {};\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"sandbox","private":true}');
  const expo = path.join(repo, 'node_modules', 'expo');
  fs.mkdirSync(path.join(expo, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(expo, 'package.json'), '{"name":"expo","version":"0.0.0"}');
  fs.writeFileSync(
    path.join(expo, 'bin', 'cli'),
    [
      "const fs = require('fs');",
      "const path = require('path');",
      "const out = process.argv[process.argv.indexOf('--output-dir') + 1];",
      "fs.writeFileSync(path.join(process.cwd(), 'exporter-ran.json'), JSON.stringify({ args: process.argv.slice(2), base: process.env.WEB_BASE_PATH ?? null }));",
      "fs.cpSync(path.join(process.cwd(), 'public'), out, { recursive: true });",
      "fs.writeFileSync(path.join(out, 'metadata.json'), '{}');",
    ].join('\n')
  );
  const run = (...args: string[]) => {
    try {
      execFileSync(process.execPath, [path.join(repo, 'scripts', 'build-web.mjs'), ...args], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WEB_BASE_PATH: '' } });
      return { status: 0, stderr: '' };
    } catch (e) {
      const error = e as { status: number; stderr: Buffer };
      return { status: error.status, stderr: String(error.stderr) };
    }
  };
  const exporter = (): { args: string[]; base: string | null } | null => {
    const file = path.join(repo, 'exporter-ran.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  };
  return { dir, repo, run, exporter, remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe('the build script', () => {
  it.each(['src', 'public', 'scripts', 'e2e', '.git', 'node_modules', '.', '..', 'dist/nested', '..cache'])('refuses --out %s before the export can empty it', (out) => {
    const box = sandbox();
    try {
      const result = box.run('--out', out);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/^build-web: --out /);
      expect(box.exporter()).toBeNull();
      expect(fs.readFileSync(path.join(box.repo, 'src', 'keep.ts'), 'utf8')).toBe('export {};\n');
    } finally {
      box.remove();
    }
  });

  it('writes to the ignored build folders, and to a folder outside the checkout', () => {
    const ignored = read('.gitignore').split('\n').map((l) => l.trim());
    for (const folder of OUT_FOLDERS) expect(ignored, folder).toContain(`${folder}/`);
    const box = sandbox();
    try {
      for (const out of [...OUT_FOLDERS, path.join(box.dir, 'elsewhere')]) {
        expect(box.run('--out', out), out).toEqual({ status: 0, stderr: '' });
        const written = path.resolve(box.repo, out);
        expect(box.exporter()?.args).toEqual(['export', '--platform', 'web', '--output-dir', written]);
        expect(fs.existsSync(path.join(written, 'metadata.json')), out).toBe(false);
        expect(fs.readFileSync(path.join(written, 'index.html'), 'utf8')).toContain('<meta http-equiv="Content-Security-Policy"');
      }
      // and to dist/ when nothing says otherwise
      expect(box.run()).toEqual({ status: 0, stderr: '' });
      expect(box.exporter()?.args).toEqual(['export', '--platform', 'web', '--output-dir', path.join(box.repo, 'dist')]);
    } finally {
      box.remove();
    }
  });
});

describe('app.config.js', () => {
  const appJson = JSON.parse(read('app.json')).expo;
  const configure = (base: string | undefined) => {
    const saved = process.env.WEB_BASE_PATH;
    if (base === undefined) delete process.env.WEB_BASE_PATH;
    else process.env.WEB_BASE_PATH = base;
    try {
      return require('../../app.config.js')({ config: appJson });
    } finally {
      if (saved === undefined) delete process.env.WEB_BASE_PATH;
      else process.env.WEB_BASE_PATH = saved;
    }
  };

  it('leaves every build but a sub-path web build with app.json exactly', () => {
    for (const base of [undefined, '', '/']) expect(configure(base), String(base)).toBe(appJson);
  });

  it('sets the base path a sub-path web build asks for, and nothing else', () => {
    expect(configure('/sudokuoku')).toEqual({ ...appJson, experiments: { baseUrl: '/sudokuoku' } });
    expect(configure('/apps/sudokuoku').experiments).toEqual({ baseUrl: '/apps/sudokuoku' });
  });

  it('is why `expo install` cannot add a config plugin to app.json, as AGENTS.md tells a contributor', async () => {
    // Expo writes nothing under `plugins` while a function-style dynamic config sits beside
    // app.json; the dry run asks without writing. When Expo learns to, or this file goes, this
    // fails, and the sentence in AGENTS.md goes with it.
    type ModifyConfig = (root: string, change: object, read: object, write: object) => Promise<{ type: string; message?: string }>;
    const expo = createRequire(require.resolve('expo/package.json'));
    const { modifyConfigAsync }: { modifyConfigAsync: ModifyConfig } = expo('@expo/config');
    const answer = await modifyConfigAsync(root, { plugins: ['expo-camera'] }, { skipSDKVersionRequirement: true }, { dryRun: true });
    expect(answer).toEqual({ type: 'warn', message: 'Cannot automatically write to dynamic config at: app.config.js', config: null });
    expect(read('AGENTS.md')).toContain(`"${answer.message}"`);
  });

  it('refuses a base path that is not one', () => {
    for (const base of ['sudokuoku', '/sudokuoku/', '//evil.example', '/../up', '/a/./b', '/a b', '/a?b', 'https://evil.example', '/a"b']) {
      expect(() => configure(base), base).toThrow(/WEB_BASE_PATH must be a path/);
    }
  });
});
