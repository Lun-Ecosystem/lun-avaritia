import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/harness.ts';
import { exportMarkdown } from './export.ts';
import { addFact, createFiche, link, listTypes, strikeFact } from './store.ts';

describe('exportMarkdown', () => {
  it('writes one file per live fiche with frontmatter, struck facts, links and unique names', () => {
    const { db } = makeHarness();
    const typeId = listTypes(db)[0]!.id;
    const at = '2026-10-01T10:00:00.000Z';
    const src = { kind: 'core' as const, origin: 'acedia', at };
    const a = createFiche(db, { typeId, title: 'Studio Exemple', synthesis: 'Un studio fictif.' }, at);
    const same = createFiche(db, { typeId, title: 'Studio  Exemple!', synthesis: '' }, at);
    const merged = createFiche(db, { typeId, title: 'Fantôme', synthesis: '' }, at);
    db.prepare('UPDATE fiches SET merged_into = ? WHERE id = ?').run(a, merged);
    const old = addFact(db, a, 'Basé à Lyon.', src, at);
    const now = addFact(db, a, 'Basé à Nantes.', src, at);
    strikeFact(db, old, now, '2026-11-02T08:00:00.000Z');
    link(db, a, same, 'partenaire de');

    const dir = mkdtempSync(join(tmpdir(), 'avaritia-export-'));
    const files = exportMarkdown(db, dir);
    expect(readdirSync(dir).sort()).toEqual(['studio-exemple-2.md', 'studio-exemple.md']);
    expect([...files].sort()).toEqual(['studio-exemple-2.md', 'studio-exemple.md']);
    const md = readFileSync(join(dir, 'studio-exemple.md'), 'utf8');
    expect(md).toMatch(/^---\ntype: Personne\n/);
    expect(md).toContain('acedia');
    expect(md).toContain('Un studio fictif.');
    expect(md).toContain('~~Basé à Lyon.~~ (barré le 02/11/2026)');
    expect(md).toContain('- Basé à Nantes.');
    expect(md).toContain('[[Studio  Exemple!]]');
    expect(md).not.toContain('Fantôme');
  });
});
