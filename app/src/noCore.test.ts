// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('.', import.meta.url));

function svelteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'catalogue' ? [] : svelteFiles(path);
    return entry.name.endsWith('.svelte') ? [path] : [];
  });
}

describe('public front', () => {
  it('never shows the word "core" in the displayed text', () => {
    const files = svelteFiles(src);
    expect(files.length).toBeGreaterThan(30);
    // The markup only: no <script>, no <style>, no HTML comment (code comments may name the core).
    const shown = (t: string) =>
      t
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '');
    const offenders = files.filter((f) => /\bcore\b/i.test(shown(readFileSync(f, 'utf8'))));
    expect(offenders).toEqual([]);
  });
});
