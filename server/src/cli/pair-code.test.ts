import { describe, expect, it } from 'vitest';
import { pair } from '../contract/auth.ts';
import { openDb } from '../db.ts';
import { pairCodeLine } from './pair-code.ts';

const LINE = /^Code d’appairage : (\d{3}) (\d{3}) · expire à (\d{2}:\d{2}) · usage unique$/;

describe('pair-code', () => {
  it('pair-code works whether clients exist or not', () => {
    const db = openDb(':memory:');
    const now = new Date('2026-11-02T08:00:00.000Z');
    const first = pairCodeLine(db, now).match(LINE)!;
    expect(first).not.toBeNull();
    expect(pair(db, first[1]! + first[2]!, 'laptop', now)).not.toBeNull();
    const second = pairCodeLine(db, now).match(LINE)!;
    expect(second).not.toBeNull();
    expect(pair(db, second[1]! + second[2]!, 'phone', now)).not.toBeNull();
  });

  it('prints the code grouped by three and its local expiry time', () => {
    const db = openDb(':memory:');
    const now = new Date('2026-11-02T08:00:00.000Z');
    const expiry = new Date('2026-11-02T08:10:00.000Z').toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(pairCodeLine(db, now).match(LINE)?.[3]).toBe(expiry);
  });
});
