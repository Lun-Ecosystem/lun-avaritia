import { z } from 'zod';

const ImportedNoteSchema = z.object({
  title: z.string(),
  body: z.string(),
  links: z.array(z.string()),
  frontmatter: z.record(z.string(), z.string()),
});
export type ImportedNote = z.infer<typeof ImportedNoteSchema>;
export { ImportedNoteSchema };

const baseName = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.md$/i, '');

/** Splits a leading `---` block; `broken` when it does not read as `key: value` lines. */
function frontmatterOf(text: string): { frontmatter: Record<string, string>; body: string; broken: boolean } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { frontmatter: {}, body: text, broken: /^---\r?\n/.test(text) };
  const frontmatter: Record<string, string> = {};
  let last: string | undefined;
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) {
      last = kv[1]!;
      frontmatter[last] = kv[2]!.replace(/^(["'])(.*)\1$/, '$2');
    } else if (/^\s*(-\s|#)/.test(line) && last !== undefined) {
      if (!line.trim().startsWith('#'))
        frontmatter[last] = [frontmatter[last], line.replace(/^\s*-\s*/, '')].filter(Boolean).join(', ');
    } else if (line.trim()) return { frontmatter: {}, body: text.slice(m[0].length), broken: true };
  }
  return { frontmatter, body: text.slice(m[0].length), broken: false };
}

/** Pure and mechanical (no LLM): never throws, problems go to `warnings`. */
export function parseVault(files: { path: string; text: string }[]): {
  notes: ImportedNote[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const notes: ImportedNote[] = [];
  for (const f of files) {
    if (!/\.md$/i.test(f.path)) continue;
    const title = baseName(f.path);
    if (!title.trim()) {
      warnings.push(`« ${f.path} » : titre vide, note ignorée.`);
      continue;
    }
    const fm = frontmatterOf(f.text);
    if (fm.broken) warnings.push(`« ${title} » : en-tête (frontmatter) illisible, ignoré.`);
    const links = new Set<string>();
    for (const m of fm.body.matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/g)) {
      const target = baseName(m[1]!.split('|')[0]!.split('#')[0]!.trim());
      if (target) links.add(target);
    }
    notes.push({ title, body: fm.body.trim(), links: [...links], frontmatter: fm.frontmatter });
  }
  const titles = new Map<string, number>();
  for (const n of notes) titles.set(n.title.toLowerCase(), (titles.get(n.title.toLowerCase()) ?? 0) + 1);
  for (const [t, count] of titles)
    if (count > 1)
      warnings.push(
        `Titre en double : « ${notes.find((n) => n.title.toLowerCase() === t)!.title} » (${count} notes).`,
      );
  for (const n of notes)
    for (const l of n.links)
      if (!titles.has(l.toLowerCase())) warnings.push(`« ${n.title} » : lien vers « ${l} », note absente.`);
  return { notes, warnings };
}
