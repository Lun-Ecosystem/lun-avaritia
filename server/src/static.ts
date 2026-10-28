import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Hono } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/** Paths owned by the server: never answered with the app shell. */
const SERVER_PATHS = /^\/(api|lun|oauth)(\/|$)/;

async function fileIn(root: string, path: string): Promise<string | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  const file = resolve(root, `.${decoded}`);
  if (file !== root && !file.startsWith(root + sep)) return undefined;
  try {
    return (await stat(file)).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serves the built standalone app from `dir`: its files, and the app shell for any other page so
 * the app's own navigation survives a reload. Registered last, after every server route.
 */
export function serveApp(app: Hono, dir: string): void {
  const root = resolve(dir);
  app.get('*', async (c) => {
    const path = c.req.path;
    if (SERVER_PATHS.test(path)) return c.notFound();
    const file = (await fileIn(root, path)) ?? (await fileIn(root, '/index.html'));
    if (!file) return c.notFound();
    const name = file.slice(root.length + 1).replaceAll(sep, '/');
    // Hashed bundles never change; the shell and the service worker must be checked every time.
    const cache = name.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    const headers: Record<string, string> = {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': cache,
    };
    // No page of the app may be framed, the authorization page (`/?autoriser=1`) first of all.
    if (extname(file) === '.html') {
      headers['content-security-policy'] = "frame-ancestors 'none'";
      headers['x-frame-options'] = 'DENY';
    }
    return c.body(await readFile(file), 200, headers);
  });
}
