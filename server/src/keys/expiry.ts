import type { DatabaseSync } from 'node:sqlite';
import { emitEvent } from '../contract/events.ts';
import { getSetting, putSetting } from '../db.ts';
import type { ProviderId } from '../llm/types.ts';

/** The warnings already sent for the declared date of a provider's key (`14`, `3`). */
export const warnedKey = (id: ProviderId) => `${id}.expiryWarned`;
/** The date those warnings were for: another date starts over. */
const warnedForKey = (id: ProviderId) => `${id}.expiryWarnedFor`;

const DAY_MS = 86_400_000;
const parisDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `AAAA-MM-JJ` and a real calendar day. */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Calendar days from today (in Paris) to `expires`. */
function daysUntil(now: Date, expires: string): number {
  const today = parisDate.format(now);
  return Math.round((Date.parse(`${expires}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / DAY_MS);
}

function title(label: string, expires: string, days: number): string {
  const [y, m, d] = expires.split('-');
  const when = days === 0 ? 'aujourd’hui' : days === 1 ? 'dans 1 jour' : `dans ${days} jours`;
  return `${label} : échéance déclarée le ${d}/${m}/${y}, ${when}`;
}

/**
 * Warns once at 14 days or less (J-14) and once at 3 days or less (J-3) before a declared expiry, in
 * calendar days, Paris time. A date declared less than 3 days ahead only gets J-3. After the date,
 * nothing: the first real refusal is what counts. The flags live in the database, so a restart sends
 * nothing twice; a new date (or a new key, see `saveKey`) starts over. Each provider has its own flags.
 */
export function checkExpiry(
  db: DatabaseSync,
  now: Date,
  expires: string | undefined,
  label: string,
  id: ProviderId,
): void {
  const WARNED = warnedKey(id);
  const WARNED_FOR = warnedForKey(id);
  if (!expires || !isValidDate(expires)) return;
  if (getSetting<string | null>(db, WARNED_FOR, null) !== expires) {
    putSetting(db, WARNED_FOR, expires);
    putSetting(db, WARNED, []);
  }
  const days = daysUntil(now, expires);
  if (days < 0) return;
  const warned = getSetting<number[]>(db, WARNED, []);
  const step = days <= 3 ? 3 : days <= 14 ? 14 : undefined;
  if (step === undefined || warned.includes(step)) return;
  // Past J-3, J-14 would come too late: it is marked as done too.
  putSetting(db, WARNED, step === 3 ? [14, 3] : [14]);
  emitEvent(
    db,
    {
      type: 'key.expiring',
      importance: step === 3 ? 'normal' : 'low',
      title: title(label, expires, days),
      data: { daysLeft: step, expires },
    },
    now,
  );
}
