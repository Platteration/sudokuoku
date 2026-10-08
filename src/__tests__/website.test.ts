/**
 * The website's hosting layer, read as text. The policy is written in five places — the
 * `_headers` file Netlify and Cloudflare Pages read, Apache's `.htaccess`, `deploy/nginx.conf`,
 * the `<meta>` in both pages for a host that sends no headers, and the README — and a value
 * changed in one of them and not the others is a site that behaves differently on each host.
 * The same goes for the rules that keep the hosting files and the repository's own files off
 * the site, and for the cache rules. `npm run test:e2e` is where the policy is measured against
 * the running app; this is where the copies are held to each other.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withBase, withPolicy } from '../../scripts/build-web.mjs';
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

/** nginx's `add_header Name "value" always;` lines with a literal value. */
function fromNginx(): Record<string, string> {
  return Object.fromEntries([...read('deploy/nginx.conf').matchAll(/^\s*add_header ([\w-]+) "([^"]*)" always;$/gm)].map((m) => [m[1]!, m[2]!]));
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

  it('is what the build writes into both pages, less frame-ancestors, which a <meta> cannot carry', () => {
    const csp = directives(header['Content-Security-Policy']!);
    const policy = metaPolicy(read('public/_headers'));
    expect([...directives(policy)]).toEqual([...csp].filter(([name]) => name !== 'frame-ancestors'));
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
 * The sample a host is asked for: every kind of file the site has, and the files that are not
 * part of it — the hosting configs and Expo's update manifest, which are in the published folder,
 * and the repository's own files, should a checkout ever be served.
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
const NOT_SITE = ['/_headers', '/_redirects', '/.htaccess', '/metadata.json', '/README.md', '/.git/config', '/.git/HEAD', '/deploy/nginx.conf', '/.env'];

describe('what the hosts refuse', () => {
  it('nginx: the hosting files and the repository answer 404, the site does not', () => {
    const conf = read('deploy/nginx.conf');
    const refusals = [...conf.matchAll(/^\s*location ~ (\S+) \{ return 404; \}$/gm)].map((m) => new RegExp(m[1]!));
    expect(refusals.length).toBeGreaterThanOrEqual(2);
    const refused = (p: string) => refusals.some((r) => r.test(p));
    expect(NOT_SITE.filter((p) => !refused(p))).toEqual([]);
    expect(SITE.filter(refused)).toEqual([]);
    // the 404 page is the error page, not a page of its own, and folders list nothing
    expect(conf).toMatch(/^\s*error_page 404 \/404\.html;$/m);
    expect(conf).toMatch(/^\s*error_page 403 =404 \/404\.html;$/m);
    expect(conf).toMatch(/^\s*location = \/404\.html \{ internal; \}$/m);
    expect(conf).toMatch(/^\s*autoindex off;$/m);
    expect(conf).toMatch(/^\s*server_tokens off;$/m);
    expect(conf).toMatch(/^\s*return 301 https:\/\/\$host\$request_uri;$/m);
  });

  it('Apache: the same paths, by the same rules', () => {
    const conf = read('public/.htaccess');
    // A rule with no RewriteCond before it holds for every request; the folder rule is the
    // one with a condition, and it is checked separately below.
    const lines = conf.split('\n').map((l) => l.trim());
    const refusals = lines
      .map((line, i) => ({ line, cond: (lines[i - 1] ?? '').startsWith('RewriteCond') }))
      .filter(({ line, cond }) => !cond && /^RewriteRule \S+ - \[R=404,L\]$/.test(line))
      .map(({ line }) => new RegExp(line.split(' ')[1]!));
    expect(refusals.length).toBeGreaterThanOrEqual(2);
    // Apache matches a per-directory rule against the path without its leading slash.
    const refused = (p: string) => refusals.some((r) => r.test(p.slice(1)));
    expect(NOT_SITE.filter((p) => !refused(p))).toEqual([]);
    expect([...SITE, '/404.html'].filter(refused)).toEqual([]);
    expect(conf).toMatch(/^\s*RewriteCond %\{REQUEST_FILENAME\} -d\n\s*RewriteRule \^\.\+\$ - \[R=404,L\]$/m);
    expect(conf).toMatch(/^Options -Indexes$/m);
    expect(conf).toMatch(/^ErrorDocument 404 \/404\.html$/m);
    expect(conf).toMatch(/^ErrorDocument 403 \/404\.html$/m);
  });

  it('Netlify: the files the build publishes that are not the site', () => {
    const rules = read('public/_redirects')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))
      .map((l) => l.trim().split(/\s+/));
    expect(rules.every((r) => r.length === 3 && r[1] === '/404.html' && r[2] === '404')).toBe(true);
    expect(rules.map((r) => r[0])).toEqual(['/_headers', '/_redirects', '/.htaccess', '/metadata.json']);
  });
});

describe('caching', () => {
  const YEAR = 'public, max-age=31536000, immutable';
  const expected = (p: string) => (/^\/(_expo\/static|assets)\//.test(p) ? YEAR : 'no-cache');

  it('is a year for names that carry their content hash, and a revalidation for the rest, on every host', () => {
    const rules = parseHeaders(read('public/_headers'));
    const map = [...read('deploy/nginx.conf').matchAll(/^\s+(default|~\S+)\s+"([^"]+)";$/gm)].map((m) => [m[1]!, m[2]!] as const);
    const nginx = (p: string) => map.find(([k]) => k !== 'default' && new RegExp(k.slice(1)).test(p))?.[1] ?? map.find(([k]) => k === 'default')?.[1];
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

  it('refuses a base path that is not one', () => {
    for (const base of ['sudokuoku', '/sudokuoku/', '//evil.example', '/../up', '/a/./b', '/a b', '/a?b', 'https://evil.example', '/a"b']) {
      expect(() => configure(base), base).toThrow(/WEB_BASE_PATH must be a path/);
    }
  });
});
