import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeHarness } from './testing/harness.ts';

function appDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'avaritia-app-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Lun’Avaritia</title>');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'sw.js'), 'self.skipWaiting()');
  writeFileSync(join(dir, 'manifest.webmanifest'), '{}');
  return dir;
}

describe('standalone app hosting', () => {
  it('serves the app shell at the root', async () => {
    const { app } = makeHarness({ staticDir: appDist() });
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await res.text()).toContain('Lun’Avaritia');
  });

  it('forbids framing the HTML pages, the authorization page included', async () => {
    const { app } = makeHarness({ staticDir: appDist() });
    for (const path of ['/', '/?autoriser=1&client=x', '/fiches', '/index.html']) {
      const res = await app.request(path);
      expect(res.headers.get('content-security-policy'), path).toBe("frame-ancestors 'none'");
      expect(res.headers.get('x-frame-options'), path).toBe('DENY');
    }
  });

  it('serves hashed assets with a long cache and the service worker without one', async () => {
    const { app } = makeHarness({ staticDir: appDist() });
    const asset = await app.request('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toMatch(/javascript/);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const sw = await app.request('/sw.js');
    expect(sw.headers.get('cache-control')).toBe('no-cache');
    const manifest = await app.request('/manifest.webmanifest');
    expect(manifest.headers.get('content-type')).toMatch(/^application\/manifest\+json/);
  });

  it('falls back to the shell for app routes but not for the API', async () => {
    const { app } = makeHarness({ staticDir: appDist() });
    expect(await (await app.request('/fiches')).text()).toContain('Lun’Avaritia');
    const api = await app.request('/api/nope');
    expect(api.headers.get('content-type')).toMatch(/json/);
    const contract = await app.request('/lun/v1/nope');
    expect(contract.status).not.toBe(200);
    expect(await contract.text()).not.toContain('Lun’Avaritia');
  });

  it('never serves a file outside the app directory', async () => {
    const { app } = makeHarness({ staticDir: appDist() });
    const res = await app.request('/assets/..%2f..%2fpackage.json');
    expect(await res.text()).not.toContain('"name"');
  });

  it('serves nothing when no app is built', async () => {
    const { app } = makeHarness();
    expect((await app.request('/')).status).toBe(404);
  });
});
