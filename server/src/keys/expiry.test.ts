import { describe, expect, it } from 'vitest';
import { eventsSince } from '../contract/events.ts';
import { openDb } from '../db.ts';
import { checkExpiry } from './expiry.ts';

const expiring = (db: ReturnType<typeof openDb>) =>
  eventsSince(db)
    .filter((e) => e.type === 'key.expiring')
    .map((e) => e.data);

describe('checkExpiry', () => {
  it('expiry: J-14 then J-3 once each, only J-3 when set 2 days ahead, reset by a new date, nothing re-emitted after restart', () => {
    const db = openDb(':memory:');
    const check = (iso: string, expires: string | undefined) =>
      checkExpiry(db, new Date(iso), expires, 'Clé Anthropic', 'anthropic');

    // 15 days ahead: nothing yet.
    check('2026-11-01T10:00:00.000Z', '2026-11-16');
    expect(expiring(db)).toEqual([]);
    // 14 days ahead, then every hour that day: one J-14.
    check('2026-11-02T08:00:00.000Z', '2026-11-16');
    check('2026-11-02T09:00:00.000Z', '2026-11-16');
    check('2026-11-05T09:00:00.000Z', '2026-11-16');
    expect(expiring(db)).toEqual([{ daysLeft: 14, expires: '2026-11-16' }]);
    const event = eventsSince(db).find((e) => e.type === 'key.expiring')!;
    expect(event.importance).toBe('low');
    expect(event.title).toContain('Clé Anthropic');
    // 3 days ahead: one J-3, then nothing more (a restart reads the same flags from the database).
    check('2026-11-13T08:00:00.000Z', '2026-11-16');
    check('2026-11-14T08:00:00.000Z', '2026-11-16');
    check('2026-11-16T08:00:00.000Z', '2026-11-16');
    check('2026-11-20T08:00:00.000Z', '2026-11-16');
    expect(expiring(db)).toEqual([
      { daysLeft: 14, expires: '2026-11-16' },
      { daysLeft: 3, expires: '2026-11-16' },
    ]);

    const last = eventsSince(db)
      .filter((e) => e.type === 'key.expiring')
      .at(-1)!;
    expect(last.importance).toBe('normal');

    // A new date resets the flags; declared 2 days ahead, only J-3 fires.
    check('2026-11-20T08:00:00.000Z', '2026-11-22');
    check('2026-11-21T08:00:00.000Z', '2026-11-22');
    expect(expiring(db).slice(2)).toEqual([{ daysLeft: 3, expires: '2026-11-22' }]);
  });

  it('counts calendar days in Paris time', () => {
    const db = openDb(':memory:');
    // 23:30 UTC on 2 November is already 3 November in Paris: 14 days before 17 November.
    checkExpiry(db, new Date('2026-11-02T23:30:00.000Z'), '2026-11-17', 'Clé Anthropic', 'anthropic');
    expect(expiring(db)).toEqual([{ daysLeft: 14, expires: '2026-11-17' }]);
  });

  it('does nothing without a date, with an invalid one, or after the date', () => {
    const db = openDb(':memory:');
    const now = new Date('2026-11-02T08:00:00.000Z');
    checkExpiry(db, now, undefined, 'Clé Anthropic', 'anthropic');
    checkExpiry(db, now, '2026-13-45', 'Clé Anthropic', 'anthropic');
    checkExpiry(db, now, '2026-11-01', 'Clé Anthropic', 'anthropic');
    expect(expiring(db)).toEqual([]);
  });
});
