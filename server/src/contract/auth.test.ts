import { describe, expect, it } from 'vitest';
import { openDb } from '../db.ts';
import { bootstrapPairing, issuePairingCode, pair, recordPairingFailure } from './auth.ts';

const MIN = 60_000;
const LOCK_LINE = 'Appairage verrouillé : 5 codes faux en 10 min, codes en cours annulés.';

function setup() {
  const db = openDb(':memory:');
  let now = new Date('2026-11-02T08:00:00.000Z');
  const lines: string[] = [];
  return {
    db,
    lines,
    now: () => now,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    fail() {
      recordPairingFailure(db, now, (l) => lines.push(l));
    },
  };
}

describe('pairing lock', () => {
  it('locks pairing after 5 failures in 10 minutes', () => {
    const s = setup();
    pair(s.db, issuePairingCode(s.db, s.now()), 'first', s.now());
    const early = issuePairingCode(s.db, s.now());
    for (let i = 0; i < 4; i++) s.fail();
    expect(s.lines).toEqual([]);
    const valid = issuePairingCode(s.db, s.now());
    expect(pair(s.db, valid, 'phone', s.now())).not.toBeNull();

    s.fail();
    expect(s.lines).toEqual([LOCK_LINE]);
    expect(pair(s.db, early, 'late', s.now())).toBeNull();
    // The counter starts over: codes asked afterwards work normally.
    expect(pair(s.db, issuePairingCode(s.db, s.now()), 'next', s.now())).not.toBeNull();
    s.fail();
    expect(s.lines).toHaveLength(1);
  });

  it('slides the window', () => {
    const s = setup();
    pair(s.db, issuePairingCode(s.db, s.now()), 'first', s.now());
    let code = '';
    for (let i = 0; i < 5; i++) {
      if (i > 0) s.advance(2.75 * MIN);
      if (i === 4) code = issuePairingCode(s.db, s.now());
      s.fail();
    }
    expect(s.lines).toEqual([]);
    expect(pair(s.db, code, 'phone', s.now())).not.toBeNull();
  });

  it('re-issues the first-run code when no client exists', () => {
    const s = setup();
    bootstrapPairing(s.db, s.now(), (l) => s.lines.push(l));
    const first = s.lines[0]!.match(/\d{3} \d{3}$/)![0].replace(' ', '');
    for (let i = 0; i < 5; i++) s.fail();
    expect(s.lines[1]).toBe(LOCK_LINE);
    expect(s.lines[2]).toMatch(/^Aucun appareil appairé\. .* : \d{3} \d{3}$/);
    const reissued = s.lines[2]!.match(/\d{3} \d{3}$/)![0].replace(' ', '');
    expect(pair(s.db, first, 'phone', s.now())).toBeNull();
    expect(pair(s.db, reissued, 'phone', s.now())).not.toBeNull();
  });
});
