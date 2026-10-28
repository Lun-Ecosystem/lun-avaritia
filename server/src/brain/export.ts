import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { getFiche } from './store.ts';

const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

const slug = (title: string) =>
  title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'fiche';

/**
 * One Markdown file per live fiche in `dir`; returns the file names.
 * shortcut: a folder on the NAS volume rather than an archive to download; an archive can come with the
 * front if the need arises.
 */
export function exportMarkdown(db: DatabaseSync, dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  const types = new Map(
    (db.prepare('SELECT id, name FROM fiche_types').all() as { id: number; name: string }[]).map((t) => [
      t.id,
      t.name,
    ]),
  );
  const rows = db.prepare('SELECT id FROM fiches WHERE merged_into IS NULL ORDER BY id').all() as {
    id: number;
  }[];
  const titles = new Map(
    (db.prepare('SELECT id, title FROM fiches').all() as { id: number; title: string }[]).map((f) => [
      f.id,
      f.title,
    ]),
  );
  const used = new Set<string>();
  const files: string[] = [];
  for (const { id } of rows) {
    const f = getFiche(db, id)!;
    const sources = [
      ...new Set(
        f.facts.map((x) => [x.source.kind, x.source.origin, x.source.ref].filter(Boolean).join(' ')),
      ),
    ];
    const live = f.links.filter((l) => l.from === id && !getFiche(db, l.to)?.mergedInto);
    const md = [
      '---',
      `type: ${types.get(f.typeId) ?? ''}`,
      `created: ${f.createdAt}`,
      `updated: ${f.updatedAt}`,
      'sources:',
      ...sources.map((s) => `  - ${JSON.stringify(s)}`),
      '---',
      '',
      `# ${f.title}`,
      '',
      f.synthesis,
      '',
      '## Faits',
      '',
      ...f.facts.map((x) => (x.struckAt ? `- ~~${x.text}~~ (barré le ${day(x.struckAt)})` : `- ${x.text}`)),
      ...(live.length
        ? ['', '## Liens', '', ...live.map((l) => `- ${l.relation} : [[${titles.get(l.to)}]]`)]
        : []),
      '',
    ].join('\n');
    let name = slug(f.title);
    for (let n = 2; used.has(name); n++) name = `${slug(f.title)}-${n}`;
    used.add(name);
    writeFileSync(join(dir, `${name}.md`), md);
    files.push(`${name}.md`);
  }
  return files;
}
