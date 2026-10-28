/** Drops `undefined` fields (zod optionals) so objects fit `exactOptionalPropertyTypes` types. */
export function stripUndefined<T extends object>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

/**
 * Runs `run` now and then every `intervalMs`, never two at a time. Errors go to `onError` and the
 * loop goes on.
 */
export function startLoop(
  run: () => Promise<unknown>,
  opts: { intervalMs: number; onError?: (err: unknown) => void },
): { stop: () => void; runNow: () => Promise<void> } {
  let running: Promise<void> | undefined;
  const runNow = () => {
    running ??= (async () => {
      try {
        await run();
      } catch (err) {
        opts.onError?.(err);
      } finally {
        running = undefined;
      }
    })();
    return running;
  };
  const timer = setInterval(() => void runNow(), opts.intervalMs);
  timer.unref();
  void runNow();
  return { stop: () => clearInterval(timer), runNow };
}

const PARIS = 'Europe/Paris';

/** Offset of Paris from UTC at an instant, in ms (DST included). */
function parisOffset(at: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: PARIS,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(new Date(at))
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
}

/** The instant at which the calendar day of `now`, in Paris, began. */
export function parisDayStart(now: Date): Date {
  const o = parisOffset(now.getTime());
  const local = new Date(now.getTime() + o);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  // The offset can differ at midnight from the one at `now` (the clocks change at night).
  return new Date(midnight - parisOffset(midnight - o));
}

/** The instant at which the calendar month of `now`, in Paris, began. */
export function parisMonthStart(now: Date): Date {
  const day = Number(new Intl.DateTimeFormat('en-GB', { timeZone: PARIS, day: 'numeric' }).format(now));
  // From noon of today, whole days back land on noon of the 1st whatever the clock changes.
  return parisDayStart(new Date(parisDayStart(now).getTime() + 12 * 3_600_000 - (day - 1) * 86_400_000));
}
