import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/harness.ts';
import { addDegraded, clearDegraded, setPaused } from './state.ts';

describe('GET /lun/v1/health', () => {
  it('reports ok with the version', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    const res = await h.app.request('/lun/v1/health', { headers: h.auth(token) });
    expect(await res.json()).toEqual({ status: 'ok', version: '0.0.0-test', agent: true });
  });

  it('reports paused', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    setPaused(h.db, true);
    const res = await h.app.request('/lun/v1/health', { headers: h.auth(token) });
    expect((await res.json()).status).toBe('paused');
  });

  it('reports degraded with its reason, over paused, and still tells the pause', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    setPaused(h.db, true);
    addDegraded(h.db, 'credit');
    const res = await h.app.request('/lun/v1/health', { headers: h.auth(token) });
    expect(await res.json()).toEqual({
      status: 'degraded',
      reason: 'credit',
      paused: true,
      version: '0.0.0-test',
      agent: true,
    });
  });

  it('keeps several reasons and clears them one by one', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    addDegraded(h.db, 'credit');
    addDegraded(h.db, 'key-refused');
    clearDegraded(h.db, 'credit');
    const res = await h.app.request('/lun/v1/health', { headers: h.auth(token) });
    expect(await res.json()).toEqual({
      status: 'degraded',
      reason: 'key-refused',
      version: '0.0.0-test',
      agent: true,
    });
    clearDegraded(h.db, 'key-refused');
    const after = await h.app.request('/lun/v1/health', { headers: h.auth(token) });
    expect((await after.json()).status).toBe('ok');
  });
});
