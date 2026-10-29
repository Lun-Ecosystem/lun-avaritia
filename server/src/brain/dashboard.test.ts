import { describe, expect, it } from 'vitest';
import { recordCost } from '../contract/costs.ts';
import { makeHarness } from '../testing/harness.ts';
import { dashboard } from './dashboard.ts';
import { addDraft } from './drafts.ts';
import { createFiche, listTypes } from './store.ts';

const src = { kind: 'note' as const, at: '2026-11-01T00:00:00Z' };

describe('dashboard', () => {
  it('counts the questions by kind, held lots, spend and recent events', () => {
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
    db.prepare("INSERT INTO lots (status, reason, created_at) VALUES ('held', 'cost-cap', ?)").run(now);
    db.prepare(
      "INSERT INTO depots (name, type, bytes, created_at) VALUES ('d.txt', 'text/plain', x'00', ?)",
    ).run(now);
    recordCost(db, { provider: 'anthropic', amount: 1.5, calls: 1 }, clock(), 'tri');

    const d = dashboard(db, clock());
    expect(d.pending).toEqual({ drafts: 4, contradictions: 2, doublons: 1 });
    expect(d.fiches).toBe(2);
    expect(d.heldLots).toBe(1);
    expect(d.monthSpend).toBeCloseTo(1.5);
    expect(d.monthlyCap).toBe(5);
    expect(d.lastRun).toBeUndefined();
    expect(d.recent.map((e) => e.what)).toEqual(
      expect.arrayContaining([expect.stringContaining('d.txt'), expect.stringContaining('refusé')]),
    );
    expect(d.recent.length).toBeLessThanOrEqual(10);
  });
});
