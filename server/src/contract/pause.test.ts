import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/harness.ts';
import { getState } from './state.ts';

describe('POST /lun/v1/pause and /resume', () => {
  it('pauses once, then answers 409', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    const pause = () =>
      h.app.request('/lun/v1/pause', { method: 'POST', headers: h.auth(token), body: '{"reason":"test"}' });
    const first = await pause();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: 'paused' });
    expect(getState(h.db).paused).toBe(true);
    const second = await pause();
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: expect.any(String) });
  });

  it('refuses to resume when already active', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    const res = await h.app.request('/lun/v1/resume', { method: 'POST', headers: h.auth(token) });
    expect(res.status).toBe(409);
  });

  it('resumes after a pause', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    await h.app.request('/lun/v1/pause', { method: 'POST', headers: h.auth(token) });
    const res = await h.app.request('/lun/v1/resume', { method: 'POST', headers: h.auth(token) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(getState(h.db).paused).toBe(false);
  });
});
