import { describe, expect, it } from 'vitest';
import { recordCost } from '../contract/costs.ts';
import { putSetting } from '../db.ts';
import { makeHarness } from '../testing/harness.ts';
import { activity, dashboard } from './dashboard.ts';
import { addDraft } from './drafts.ts';
import { createFiche, listTypes } from './store.ts';

const src = { kind: 'note' as const, at: '2026-11-01T00:00:00Z' };

describe('dashboard', () => {
  it('counts the questions by kind, spend and recent events', () => {
    const { db, clock } = makeHarness();
    const now = clock().toISOString();
    const typeId = listTypes(db)[0]!.id;
    const a = createFiche(db, { typeId, title: 'A', synthesis: '' }, now);
    const b = createFiche(db, { typeId, title: 'B', synthesis: '' }, now);
    const fiche = (replaces?: number) => ({
      kind: 'fiche' as const,
      typeId,
      title: 'F',
      synthesis: '',
      facts: [{ text: 't', source: src, ...(replaces && { replaces }) }],
      links: [],
    });
    addDraft(db, fiche(), { source: 'note' }, now);
    addDraft(db, fiche(7), { source: 'note' }, now); // carries a `replaces`: counts as a contradiction
    addDraft(
      db,
      { kind: 'contradiction', ficheId: a, keep: 1, strike: 2, reason: 'r' },
      { source: 'core' },
      now,
    );
    addDraft(db, { kind: 'doublon', keep: a, merge: b, reason: 'r' }, { source: 'core' }, now);
    const refused = addDraft(db, fiche(), { source: 'note' }, now);
    db.prepare("UPDATE drafts SET status = 'refused', decided_at = ? WHERE id = ?").run(now, refused);
    db.prepare(
      "INSERT INTO depots (name, type, bytes, created_at) VALUES ('d.txt', 'text/plain', x'00', ?)",
    ).run(now);
    recordCost(db, { provider: 'anthropic', amount: 1.5, calls: 1 }, clock(), 'tri');

    const d = dashboard(db, clock());
    expect(d.pending).toEqual({ drafts: 4, contradictions: 2, doublons: 1 });
    expect(d.fiches).toBe(2);
    expect(d.monthSpend).toBeCloseTo(1.5);
    expect(d.monthlyCap).toBe(5);
    expect(d.lastRun).toBeUndefined();
    expect(d.recent.map((e) => e.what)).toEqual(
      expect.arrayContaining([expect.stringContaining('d.txt'), expect.stringContaining('refusé')]),
    );
    expect(d.recent.length).toBeLessThanOrEqual(5);
  });

  it('counts the lots held at the cap, and only while the cap is reached', () => {
    const { db, clock } = makeHarness();
    const hold = db.prepare("INSERT INTO lots (status, reason, created_at) VALUES ('held', ?, ?)");
    hold.run('cost-cap', clock().toISOString());
    // Held without a provider, or on an outage: the cap's banner does not count them.
    hold.run('no-provider', clock().toISOString());
    hold.run('provider-unavailable', clock().toISOString());
    recordCost(db, { provider: 'anthropic', amount: 5, calls: 1 }, clock(), 'tri');
    expect(dashboard(db, clock()).heldLots).toBe(1);
    // The cap raised: the lot waits for the next one, but the cap is no longer reached.
    putSetting(db, 'cost.monthlyCap', 10);
    expect(dashboard(db, clock()).heldLots).toBe(0);
  });

  it('serves the activity by pages, the dashboard only its first lines', () => {
    const { db } = makeHarness();
    const add = db.prepare(
      "INSERT INTO drafts (kind, payload, origin, status, created_at, decided_at) VALUES ('fiche', '{}', '{}', 'refused', ?, ?)",
    );
    for (let i = 0; i < 7; i++) {
      const at = `2026-11-0${i + 1}T08:00:00.000Z`;
      add.run(at, at);
    }
    const d = dashboard(db, new Date('2026-11-08T08:00:00.000Z'));
    expect(d.recent).toHaveLength(5);
    expect(d.recentMore).toBe(true);
    expect(d.recent[0]?.at).toBe('2026-11-07T08:00:00.000Z');

    const next = activity(db, 5, 5);
    expect(next.items.map((e) => e.at)).toEqual(['2026-11-02T08:00:00.000Z', '2026-11-01T08:00:00.000Z']);
    expect(next.more).toBe(false);
  });
});
