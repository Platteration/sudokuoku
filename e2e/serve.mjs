/**
 * A static host for the built website, the way the end-to-end suite needs one: it serves the
 * folder under a sub-path, as a GitHub Pages project site would, and sends the response headers
 * exactly as the build's own `_headers` file writes them, as Netlify and Cloudflare Pages would.
 * A request outside the sub-path is refused, so the suite sees any URL the site writes from the
 * domain's root.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

import { headersFor, parseHeaders } from '../scripts/headers.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

/**
 * Serves `dir` at `base` (`/sudokuoku`) on a free port of 127.0.0.1. `outside` collects every
 * request that was not for the site. `transform` rewrites the headers `_headers` gives a
 * response before they are sent (`() => ({})` is a host that sends none, as GitHub Pages sends
 * none of these). Returns the origin and a close function.
 */
export async function serveSite({ dir, base, transform = (headers) => headers }) {
  const root = resolve(dir);
  const rules = parseHeaders(readFileSync(resolve(root, '_headers'), 'utf8'));
  const outside = [];
  const notFound = readFileSync(resolve(root, '404.html'));

  const server = createServer((req, res) => {
    const raw = (req.url ?? '/').split('?')[0] ?? '/';
    let path;
    try {
      path = decodeURIComponent(raw);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!path.startsWith(`${base}/`)) {
      outside.push(req.url);
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not part of the site');
      return;
    }
    const sitePath = path.slice(base.length); // starts with '/'
    const file = resolve(root, `.${sitePath.endsWith('/') ? `${sitePath}index.html` : sitePath}`);
    const inside = file.startsWith(root + sep);
    // What every host config here refuses: a dotfile other than the security contact, and the
    // hosting files themselves.
    const refused = /(^|\/)\.(?!well-known\/)/.test(sitePath) || /^\/(_headers|_redirects|metadata\.json)$/.test(sitePath);
    const found = inside && !refused && existsSync(file) && statSync(file).isFile();
    const headers = transform(headersFor(rules, sitePath).headers);
    if (!found) {
      res.writeHead(404, { ...headers, 'Content-Type': TYPES['.html'] }).end(notFound);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('the server has no port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    rules,
    outside,
    close: () => new Promise((done) => server.close(done)),
  };
}
