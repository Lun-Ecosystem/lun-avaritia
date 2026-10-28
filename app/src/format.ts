const TZ = 'Europe/Paris';

/** Costs are in dollars. */
export const formatCost = (dollars: number): string =>
  `${dollars.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

const part = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  d.toLocaleString('fr-FR', { timeZone: TZ, ...opts });
const day = (d: Date) => part(d, { year: 'numeric', month: '2-digit', day: '2-digit' });

/** `18:12` today, `hier 18:12`, else `26/10` (Paris time). */
export function formatWhen(iso: string, now: Date): string {
  const d = new Date(iso);
  const time = part(d, { hour: '2-digit', minute: '2-digit' });
  if (day(d) === day(now)) return time;
  // 24 h back can skip a day at a DST change; 36 h is safe either way.
  if (day(d) === day(new Date(now.getTime() - 24 * 3600_000))) return `hier ${time}`;
  return part(d, { day: '2-digit', month: '2-digit' });
}

/** `28/10` (Paris time). */
export const formatDay = (iso: string): string => part(new Date(iso), { day: '2-digit', month: '2-digit' });
