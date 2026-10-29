import { describe, expect, it } from 'vitest';
import { formatCost, formatDay, formatDuration, formatWhen } from './format.ts';

const now = new Date('2026-10-28T10:00:00Z'); // 11:00 in Paris

describe('format', () => {
  it('formats a cost in dollars', () => {
    expect(formatCost(0.0213)).toBe('0,02 $');
    expect(formatCost(0)).toBe('0,00 $');
  });
  it('formats a duration', () => {
    expect(formatDuration(41_000)).toBe('41 s');
    expect(formatDuration(125_000)).toBe('2 min 05 s');
    expect(formatDuration(400)).toBe('0 s');
  });
  it('formats a day in Paris time', () => {
    expect(formatDay('2026-10-27T23:30:00Z')).toBe('28/10');
  });
  it('formats a date in Paris time', () => {
    expect(formatWhen('2026-10-27T17:12:00Z', now)).toBe('hier 18:12');
    expect(formatWhen('2026-10-28T08:05:00Z', now)).toBe('09:05');
    expect(formatWhen('2026-10-26T12:00:00Z', now)).toBe('26/10');
    // 23:30 UTC on the 27th is already the 28th in Paris
    expect(formatWhen('2026-10-27T23:30:00Z', now)).toBe('00:30');
  });
});
