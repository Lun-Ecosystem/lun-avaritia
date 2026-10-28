import { describe, expect, it } from 'vitest';
import { tokens } from './markdown.ts';

describe('tokens', () => {
  it('turns [[Fiche]] into a link', () => {
    expect(tokens('a [[Client X]] b')).toContainEqual({ kind: 'link', text: 'Client X' });
  });

  it('keeps HTML as plain text', () => {
    const input = '<img src=x onerror=alert(1)>';
    expect(tokens(input)).toEqual([{ kind: 'text', text: input }]);
  });

  it('reads bold, italics, line breaks and paragraphs, nothing else', () => {
    expect(tokens('**Gras** et *pench*\nsuite\n\n# titre')).toEqual([
      { kind: 'strong', text: 'Gras' },
      { kind: 'text', text: ' et ' },
      { kind: 'em', text: 'pench' },
      { kind: 'break' },
      { kind: 'text', text: 'suite' },
      { kind: 'para' },
      { kind: 'text', text: '# titre' },
    ]);
  });

  it('reads an unclosed [[ in linear time, as text', () => {
    const line = '[['.repeat(25_000);
    const start = performance.now();
    const out = tokens(line);
    expect(performance.now() - start).toBeLessThan(100);
    expect(out).toEqual([{ kind: 'text', text: line }]);
  });

  it('leaves a lone star between spaces as text', () => {
    expect(tokens('2 * 3 * 4')).toEqual([{ kind: 'text', text: '2 * 3 * 4' }]);
    expect(tokens('a ** b ** c')).toEqual([{ kind: 'text', text: 'a ** b ** c' }]);
    expect(tokens('*a *')).toEqual([{ kind: 'text', text: '*a *' }]);
  });
});
