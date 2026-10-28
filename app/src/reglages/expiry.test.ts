import { describe, expect, it } from 'vitest';
import { daysUntil, expiryLine } from './expiry.ts';

// 22:30 UTC is 23:30 in Paris (winter time): still the 27th there.
const NOW = new Date('2026-10-27T22:30:00.000Z');

describe('declared expiry', () => {
  it('counts calendar days in Paris, as the server does', () => {
    expect(daysUntil(NOW, '2027-08-11')).toBe(288);
    // Past midnight in Paris (23:30 UTC on the 27th), the 28th has begun.
    expect(daysUntil(new Date('2026-10-27T23:30:00.000Z'), '2026-10-28')).toBe(0);
  });

  it('says the date and the days left, warning from 14 days, danger once past', () => {
    expect(expiryLine(NOW, '2027-08-11')).toEqual({ text: '11 août 2027 · dans 288 jours', tone: 'neutre' });
    expect(expiryLine(NOW, '2026-11-10')).toEqual({
      text: '10 nov. 2026 · dans 14 jours',
      tone: 'attention',
    });
    expect(expiryLine(NOW, '2026-10-28').text).toBe('28 oct. 2026 · dans 1 jour');
    expect(expiryLine(NOW, '2026-10-27')).toEqual({ text: '27 oct. 2026 · aujourd’hui', tone: 'attention' });
    expect(expiryLine(NOW, '2026-10-20')).toEqual({
      text: '20 oct. 2026 · dépassée depuis 7 jours',
      tone: 'danger',
    });
    expect(expiryLine(NOW, '2026-10-26').text).toBe('26 oct. 2026 · dépassée depuis 1 jour');
  });
});
