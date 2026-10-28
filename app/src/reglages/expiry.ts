import type { Tone } from '../lib/ui/index.ts';

/*
 * The declared expiry of a key, as the provider card says it. Calendar days in Europe/Paris, the
 * same rule as the server (`keys/expiry.ts`): its warnings come at 14 and 3 days.
 */

const DAY_MS = 86_400_000;
const parisDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar days from today (in Paris) to `expires` (`AAAA-MM-JJ`); negative once past. */
export function daysUntil(now: Date, expires: string): number {
  const today = parisDate.format(now);
  return Math.round((Date.parse(`${expires}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / DAY_MS);
}

/** `AAAA-MM-JJ` as « 11 août 2027 », without going through the local time zone. */
export const longDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

const jours = (n: number) => `${n} jour${n > 1 ? 's' : ''}`;

/** « 11 août 2027 · dans 288 jours »; attention from 14 days, danger once the date is past. */
export function expiryLine(now: Date, expires: string): { text: string; tone: Tone } {
  const days = daysUntil(now, expires);
  const when =
    days > 0 ? `dans ${jours(days)}` : days === 0 ? 'aujourd’hui' : `dépassée depuis ${jours(-days)}`;
  return {
    text: `${longDay(expires)} · ${when}`,
    tone: days < 0 ? 'danger' : days <= 14 ? 'attention' : 'neutre',
  };
}
