import { isIP } from 'node:net';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import type { AppDeps } from '../app.ts';
import { codeExpiry, firstPairingCode } from './auth.ts';

/** The headers a relay sets (`tailscale serve` among them): a relayed request only looks local. */
const RELAYED = /^(x-forwarded-|tailscale-|forwarded$)/;

/** 127.0.0.0/8 and ::1, IPv4 loopback written as IPv6 included; a socket address is always numeric. */
const isLoopback = (address: string | undefined): boolean =>
  address === '::1' || /^(::ffff:)?127\./.test(address ?? '');

/** Avaritia's address (lun-docs, environnements.md) when it listens on a loopback address or `localhost`. */
export const localOriginFor = (hostname: string, port: number): string | undefined =>
  // Listening on ::1, or on localhost (bound to ::1 alone on Windows), Avaritia is not reached at 127.0.0.1:
  // no page gets the code there.
  hostname === 'localhost' || (isIP(hostname) !== 0 && isLoopback(hostname))
    ? `http://127.0.0.1:${port}`
    : undefined;

function callerAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined; // No socket to read: a refusal, never a 500.
  }
}

/** The page of this machine, at Avaritia's own address, asked directly. */
function fromThisMachine(c: Context, localOrigin: string): boolean {
  if (!isLoopback(callerAddress(c))) return false;
  // Both as the browser writes them: a default port (`:80`) is left out.
  const { host, origin } = new URL(localOrigin);
  // A `no-referrer` policy (secureHeaders()' default) makes the browser send `Origin: null`: no code then.
  if (c.req.header('host') !== host || c.req.header('origin') !== origin) return false;
  return ![...c.req.raw.headers.keys()].some((name) => RELAYED.test(name));
}

/**
 * `POST /first-code`: the first device's code, for the page of the machine that hosts Avaritia, until
 * a client is live. Any other request gets the same 404 and creates no code.
 */
export function firstCodeRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.post('/', (c) => {
    const code =
      deps.localOrigin && fromThisMachine(c, deps.localOrigin)
        ? firstPairingCode(deps.db, deps.clock())
        : undefined;
    if (!code) return c.json({ error: 'Pas de code ici' }, 404);
    c.header('Cache-Control', 'no-store');
    return c.json({ code, expiresAt: codeExpiry(deps.db, code) });
  });
  return r;
}
