import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLoops, type AppDeps } from './app.ts';
import type { BrainDeps } from './brain/process.ts';
import { emitEvent, eventsSince, pruneEvents } from './contract/events.ts';
import { checkKeyExpiries } from './llm/keys.ts';
import { makeHarness } from './testing/harness.ts';

// Each hourly task stays itself, unless a test makes it throw.
vi.mock(import('./contract/events.ts'), async (actual) => {
  const m = await actual();
  return { ...m, pruneEvents: vi.fn(m.pruneEvents) };
});
vi.mock(import('./llm/keys.ts'), async (actual) => {
  const m = await actual();
  return { ...m, checkKeyExpiries: vi.fn(m.checkKeyExpiries) };
});

const HOUR = 3_600_000;
/** Only the loops' timer is simulated: a real tick lets the passes it started run. */
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers(); // drops the loops' timers
  vi.restoreAllMocks();
});

function setup(brainProvider: BrainDeps['provider'] = () => undefined) {
  const h = makeHarness();
  const deps: AppDeps = { db: h.db, clock: h.clock, version: 'x', actions: h.actions, brainProvider };
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  return { h, deps, errors };
}

describe('startLoops', () => {
  it('logs a key check or an event purge that throws, and runs it again the next hour', async () => {
    const { h, deps, errors } = setup();
    vi.mocked(checkKeyExpiries).mockImplementationOnce(() => {
      throw new Error('disk I/O error');
    });
    vi.mocked(pruneEvents).mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    startLoops(deps);
    await tick();
    expect(errors).toHaveBeenCalledWith(
      'Échéance des clés :',
      expect.objectContaining({ message: 'disk I/O error' }),
    );
    expect(errors).toHaveBeenCalledWith(
      'Purge des événements :',
      expect.objectContaining({ message: 'database is locked' }),
    );

    emitEvent(h.db, { type: 't', importance: 'info', title: 'old' }, new Date('2026-10-25T07:59:00Z'));
    vi.advanceTimersByTime(HOUR);
    await tick();
    expect(checkKeyExpiries).toHaveBeenCalledTimes(2);
    expect(pruneEvents).toHaveBeenCalledTimes(2);
    expect(eventsSince(h.db)).toEqual([]); // the purge went through this time
    expect(errors).toHaveBeenCalledTimes(2);
  });
});
