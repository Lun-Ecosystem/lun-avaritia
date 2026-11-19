import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/harness.ts';
import { exportMarkdown } from './export.ts';
import { addFact, createFiche, link, listTypes, strikeFact } from './store.ts';

describe('exportMarkdown', () => {
  it('returns one file per live fiche, in memory, with frontmatter, struck facts, links and unique names', () => {
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

    const files = exportMarkdown(db);
    expect(files.map((f) => f.name).sort()).toEqual(['studio-exemple-2.md', 'studio-exemple.md']);
    const md = files.find((f) => f.name === 'studio-exemple.md')!.text;
    expect(md).toMatch(/^---\ntype: "Personne"\n/);
    expect(md).toContain('acedia');
    expect(md).toContain('Un studio fictif.');
    expect(md).toContain('~~Basé à Lyon.~~ (barré le 02/11/2026)');
    expect(md).toContain('- Basé à Nantes.');
    expect(md).toContain('[[Studio  Exemple!]]');
    expect(md).not.toContain('Fantôme');
  });

  it('caps the file name and avoids Windows device names', () => {
    const { db } = makeHarness();
    const typeId = listTypes(db)[0]!.id;
    const at = '2026-10-01T10:00:00.000Z';
    for (const title of ['CON', 'Com1', 'x'.repeat(300)])
      createFiche(db, { typeId, title, synthesis: '' }, at);
    const files = exportMarkdown(db).map((f) => f.name);
    expect(files).toEqual(['con-fiche.md', 'com1-fiche.md', `${'x'.repeat(80)}.md`]);
  });
});
