import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/harness.ts';
import { issuePairingCode } from './auth.ts';

const json = { 'content-type': 'application/json' };

describe('POST /lun/v1/pair lock', () => {
  it('voids pending codes after 5 wrong codes and logs a warning', async () => {
    const h = makeHarness();
    const code = issuePairingCode(h.db, h.clock());
    const pair = (c: string) =>
      h.app.request('/lun/v1/pair', { method: 'POST', headers: json, body: JSON.stringify({ code: c }) });
    for (let i = 0; i < 5; i++) expect((await pair('000000')).status).toBe(401);
    expect(h.logs).toContain('Appairage verrouillé : 5 codes faux en 10 min, codes en cours annulés.');
    expect((await pair(code)).status).toBe(401);
  });

  it('records the device kind for a six-digit pairing', async () => {
    const h = makeHarness();
    await h.pairClient('phone');
    expect(h.db.prepare('SELECT name, kind FROM clients').all()).toEqual([{ name: 'phone', kind: 'device' }]);
  });
});
