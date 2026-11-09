import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(import.meta.dirname, '..', path), 'utf8');

describe("room under what scrolls beneath the agent's bubble", () => {
  it('is one custom property, derived from the bubble size and offset, and nil on a phone', () => {
    const base = read('lib/base.css');
    expect(base.match(/^\s+--agent-coin:/gm)).toHaveLength(2);
    expect(base).toMatch(
      /--agent-coin: calc\(var\(--agent-lanceur-h\) \+ var\(--agent-lanceur-bas\) \+ \d+px\)/,
    );
    expect(base).toMatch(/max-width: 767\.98px\) \{\s*:root \{\s*--agent-coin: 0px/);
    const bulle = read('agent/Bulle.svelte');
    expect(bulle).toContain('bottom: var(--agent-lanceur-bas)');
    expect(bulle).toContain('height: var(--agent-lanceur-h)');
  });

  it('ends every screen that scrolls under the bubble, at the desk', () => {
    for (const f of [
      'screens/Tableau.svelte',
      'screens/Valider.svelte',
      'screens/Depots.svelte',
      'screens/Memoire.svelte',
      'memoire/Graphe.svelte',
    ])
      expect(read(f), f).toContain('var(--agent-coin)');
  });
});
