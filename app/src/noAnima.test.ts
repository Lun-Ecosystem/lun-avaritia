// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('.', import.meta.url));
const pages = ['../index.html', '../catalogue.html'].map((p) => fileURLToPath(new URL(p, import.meta.url)));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|svelte|css|html)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}
const files = () => [...sources(src), ...pages];

describe('standalone front', () => {
  it('no "Anima" nor "Natsume" in the standalone front', () => {
    expect(files().length).toBeGreaterThan(40);
    // Case-insensitive; `animation` (CSS) is not the name.
    const offenders = files().filter((f) => /anima(?![a-z])|natsume/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no em dash in what is displayed', () => {
    const strip = (t: string) =>
      t
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/(^|[^:'"`\w])\/\/[^\n]*/g, '$1');
    const offenders = files().filter((f) => strip(readFileSync(f, 'utf8')).includes('—'));
    expect(offenders).toEqual([]);
  });
});
