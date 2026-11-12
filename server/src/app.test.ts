import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { brainDeps, startLoops, type AppDeps } from './app.ts';
import { runPending } from './brain/ingest.ts';
import type { BrainDeps } from './brain/process.ts';
import { listTypes } from './brain/store.ts';
import { emitEvent, eventsSince, pruneEvents } from './contract/events.ts';
import { setPaused } from './contract/state.ts';
import { checkKeyExpiries } from './llm/keys.ts';
import { fakeProvider } from './testing/fake-provider.ts';
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
vi.mock(import('./brain/ingest.ts'), async (actual) => {
  const m = await actual();
  return { ...m, runPending: vi.fn(m.runPending) };
});

const HOUR = 3_600_000;
/** Only the loops' timer is simulated: a real tick lets the passes it started run. */
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.resetAllMocks(); // back to the real task, with no throw left over by a test that stopped short
});
afterEach(() => {
  vi.useRealTimers(); // drops the loops' timers
  vi.restoreAllMocks();
});

function setup(brainProvider: BrainDeps['provider'] = () => undefined) {
  const h = makeHarness();
  const deps: AppDeps = { db: h.db, clock: h.clock, version: 'x', actions: h.actions, brainProvider };
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  // A lot as the core left it, with no request: only a loop can run it.
  const addLot = (status: string, reason: string | null = null) => {
    const { lastInsertRowid } = h.db
      .prepare('INSERT INTO lots (status, reason, created_at) VALUES (?, ?, ?)')
      .run(status, reason, h.clock().toISOString());
    const source = { kind: 'core', origin: 'acedia', ref: 'm1', at: '2026-11-01T18:00:00Z' };
    h.db
      .prepare('INSERT INTO observations (lot, text, source) VALUES (?, ?, ?)')
      .run(lastInsertRowid, 'Le client X a signé le devis.', JSON.stringify(source));
    return Number(lastInsertRowid);
  };
  const status = (id: number) =>
    (h.db.prepare('SELECT status FROM lots WHERE id = ?').get(id) as { status: string }).status;
  const typeId = listTypes(h.db)[0]!.id;
  const lotReplies = () => [
    { groups: [{ observations: [0], ficheId: null, typeId, title: 'Client X' }] },
    {
      fiches: [
        {
          group: 0,
          synthesis: 'Client fictif.',
          facts: [{ text: 'Le client X a signé.', observation: 0, replaces: null, due: null }],
          links: [],
        },
      ],
      questions: [],
    },
  ];
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 200 && !done(); i++) await tick(5);
  };
  return { h, deps, errors, addLot, status, lotReplies, until };
}

const model = (use: 'tri' | 'agent') => (use === 'tri' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5');

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

  it('logs a pass of the lots that throws, and runs it again the next hour', async () => {
    const t = setup();
    const fake = fakeProvider(t.lotReplies());
    const deps: AppDeps = {
      ...t.deps,
      brainProvider: (use) => ({ provider: fake.provider, model: model(use) }),
    };
    vi.mocked(runPending).mockRejectedValueOnce(new Error('database is locked'));
    const lot = t.addLot('queued');
    startLoops(deps);
    await tick();
    expect(t.errors).toHaveBeenCalledWith(
      'Traitement des lots :',
      expect.objectContaining({ message: 'database is locked' }),
    );
    expect(t.status(lot)).toBe('queued');

    vi.advanceTimersByTime(HOUR);
    await t.until(() => t.status(lot) === 'done');
    expect(t.status(lot)).toBe('done'); // the pass went through this time
    expect(runPending).toHaveBeenCalledTimes(2);
    expect(t.errors).toHaveBeenCalledTimes(1);
  });

  it('runs a held lot within the hour its provider is back, with no lot from the core', async () => {
    let provider: BrainDeps['provider'] = () => undefined;
    const t = setup((use) => provider(use));
    const fake = fakeProvider(t.lotReplies());
    const lot = t.addLot('held', 'no-provider');
    startLoops(t.deps);
    await tick();
    expect(t.status(lot)).toBe('held'); // the pass at start: still no provider

    provider = (use) => ({ provider: fake.provider, model: model(use) });
    await tick(20);
    expect(t.status(lot)).toBe('held'); // nothing runs it between two hours
    vi.advanceTimersByTime(HOUR);
    await t.until(() => t.status(lot) === 'done');
    expect(t.status(lot)).toBe('done');
    expect(fake.calls).toHaveLength(2);
    expect(t.errors).not.toHaveBeenCalled();
  });

  it('skips the hourly pass in pause, and never runs it alongside another pass', async () => {
    const t = setup();
    const fake = fakeProvider([...t.lotReplies(), ...t.lotReplies()]);
    let active = 0;
    let peak = 0;
    const inner = fake.provider.json.bind(fake.provider);
    fake.provider.json = async (req) => {
      peak = Math.max(peak, ++active);
      await tick(20);
      try {
        return await inner(req);
      } finally {
        active--;
      }
    };
    const deps: AppDeps = {
      ...t.deps,
      brainProvider: (use) => ({ provider: fake.provider, model: model(use) }),
    };
    setPaused(t.h.db, true, 'core');
    const first = t.addLot('queued');
    const second = t.addLot('queued');
    startLoops(deps);
    vi.advanceTimersByTime(HOUR);
    await tick(20);
    expect([t.status(first), t.status(second)]).toEqual(['queued', 'queued']);
    expect(fake.calls).toHaveLength(0);

    setPaused(t.h.db, false, 'core');
    vi.advanceTimersByTime(HOUR);
    expect(t.status(first)).toBe('running'); // the hour's pass took it
    await runPending(brainDeps(deps)); // a lot from the core meanwhile: its pass gives way
    vi.advanceTimersByTime(HOUR); // and so does the next hour's
    await t.until(() => t.status(second) === 'done');
    expect([t.status(first), t.status(second)]).toEqual(['done', 'done']);
    expect(peak).toBe(1);
    expect(fake.calls).toHaveLength(4);
  });
});
