/*
 * The small Markdown of a synthesis, cut into tokens that Svelte renders as text: paragraphs, line
 * breaks, **bold**, *italics* and [[Fiche]] links. Nothing else is read, HTML included.
 */

export type Token =
  { kind: 'text' | 'strong' | 'em' | 'link'; text: string } | { kind: 'break' } | { kind: 'para' };

// Bodies are capped (200 characters, one line) so an unclosed marker costs a bounded scan; emphasis
// needs a non-space, non-star right inside each marker, so `2 * 3 * 4` stays text.
const INLINE =
  /\*\*([^\s*](?:[^\n]{0,198}?[^\s*])?)\*\*|\*([^\s*](?:[^\n]{0,198}?[^\s*])?)\*|\[\[([^\]\n]{1,200})\]\]/g;

function inline(line: string, out: Token[]) {
  let last = 0;
  for (const m of line.matchAll(INLINE)) {
    if (m.index > last) out.push({ kind: 'text', text: line.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'strong', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'em', text: m[2] });
    else out.push({ kind: 'link', text: m[3]! });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
}

export function tokens(md: string): Token[] {
  const out: Token[] = [];
  const paras = md
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  paras.forEach((p, i) => {
    if (i > 0) out.push({ kind: 'para' });
    p.split('\n').forEach((line, j) => {
      if (j > 0) out.push({ kind: 'break' });
      inline(line, out);
    });
  });
  return out;
}
