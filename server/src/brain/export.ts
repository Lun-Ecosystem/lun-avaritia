import type { DatabaseSync } from 'node:sqlite';
import { getFiche } from './store.ts';

const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

const slug = (title: string) => {
  const s =
    title
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/, '') || 'fiche';
  return DEVICE.test(s) ? `${s}-fiche` : s; // Windows refuses these names, even with an extension
};

/** One Markdown file per live fiche, by id, in memory. */
export function exportMarkdown(db: DatabaseSync): { name: string; text: string }[] {
  const types = new Map(
    (db.prepare('SELECT id, name FROM fiche_types').all() as { id: number; name: string }[]).map((t) => [
      t.id,
      t.name,
    ]),
  );
  const rows = db.prepare('SELECT id FROM fiches WHERE merged_into IS NULL ORDER BY id').all() as {
    id: number;
  }[];
  const fiches = new Map(
    (
      db.prepare('SELECT id, title, merged_into FROM fiches').all() as {
        id: number;
        title: string;
        merged_into: number | null;
      }[]
    ).map((f) => [f.id, f]),
  );
  const used = new Set<string>();
  const files: { name: string; text: string }[] = [];
  for (const { id } of rows) {
    const f = getFiche(db, id)!;
    const sources = [
      ...new Set(
        f.facts.map((x) => [x.source.kind, x.source.origin, x.source.ref].filter(Boolean).join(' ')),
      ),
    ];
    const live = f.links.filter((l) => l.from === id && !fiches.get(l.to)?.merged_into);
    const md = [
      '---',
      `type: ${JSON.stringify(types.get(f.typeId) ?? '')}`,
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
        ? ['', '## Liens', '', ...live.map((l) => `- ${l.relation} : [[${fiches.get(l.to)?.title}]]`)]
        : []),
      '',
    ].join('\n');
    let name = slug(f.title);
    for (let n = 2; used.has(name); n++) name = `${slug(f.title)}-${n}`;
    used.add(name);
    files.push({ name: `${name}.md`, text: md });
  }
  return files;
}
