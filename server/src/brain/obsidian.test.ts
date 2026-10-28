import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVault } from './obsidian.ts';

const dir = join(import.meta.dirname, '../testing/vault');
export const vault = readdirSync(dir, { recursive: true, encoding: 'utf8' })
  .filter((p) => p.endsWith('.md'))
  .map((p) => ({ path: p.replaceAll('\\', '/'), text: readFileSync(join(dir, p), 'utf8') }));

describe('parseVault', () => {
  const { notes, warnings } = parseVault(vault);

  it('keeps notes, frontmatter and links (aliases and headings stripped)', () => {
    expect(notes).toHaveLength(6);
    const atelier = notes.find((n) => n.title === 'Atelier')!;
    expect(atelier.links).toEqual(['Jean Martin', 'Studio Exemple', 'Idée fantôme']);
    expect(atelier.frontmatter).toEqual({ title: 'Atelier', tags: 'demo' });
    expect(atelier.body).toContain('Le projet');
    expect(notes.find((n) => n.title === 'Studio Exemple')!.links).toEqual(['Atelier']);
  });

  it('warns about a missing target, a duplicate title and a broken frontmatter, without throwing', () => {
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Idée fantôme'),
        expect.stringContaining('Titre en double'),
        expect.stringContaining('Cassée'),
      ]),
    );
    const broken = notes.find((n) => n.title === 'Cassée')!;
    expect(broken.frontmatter).toEqual({});
    expect(broken.body).toBe('Corps malgré tout.');
  });

  it('ignores non-Markdown files and survives an unclosed frontmatter', () => {
    expect(parseVault([{ path: 'a.png', text: 'x' }])).toEqual({ notes: [], warnings: [] });
    expect(parseVault([{ path: 'x.md', text: '---\nnever closed' }]).notes).toHaveLength(1);
  });
});
