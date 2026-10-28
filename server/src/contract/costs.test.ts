import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/harness.ts';
import { recordCost } from './costs.ts';

describe('GET /lun/v1/costs', () => {
  it('rejects an unreadable since', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    const res = await h.app.request('/lun/v1/costs?since=pas-une-date', { headers: h.auth(token) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  it('sums the costs since a date, grouped by provider and model', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    const at = h.clock();
    recordCost(h.db, { provider: 'anthropic', model: 'm1', amount: 0.012, calls: 1 }, at);
    recordCost(h.db, { provider: 'anthropic', model: 'm1', amount: 0.008, calls: 1 }, at);
    recordCost(h.db, { provider: 'anthropic', model: 'm2', amount: 0.5, calls: 2 }, at);
    recordCost(
      h.db,
      { provider: 'anthropic', model: 'm1', amount: 9, calls: 1 },
      new Date('2026-10-01T00:00:00Z'),
    );
    const res = await h.app.request('/lun/v1/costs?since=2026-11-01T00:00:00.000Z', {
      headers: h.auth(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currency).toBe('USD');
    expect(body.since).toBe('2026-11-01T00:00:00.000Z');
    expect(body.until).toBe('2026-11-02T08:00:00.000Z');
    expect(body.total).toBeCloseTo(0.52, 6);
    expect(body.items).toEqual(
      expect.arrayContaining([
        { provider: 'anthropic', model: 'm1', amount: expect.closeTo(0.02, 6), calls: 2 },
        { provider: 'anthropic', model: 'm2', amount: 0.5, calls: 2 },
      ]),
    );
    expect(body.items).toHaveLength(2);
  });
});
