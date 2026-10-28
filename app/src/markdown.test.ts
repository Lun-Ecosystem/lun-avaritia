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
});
