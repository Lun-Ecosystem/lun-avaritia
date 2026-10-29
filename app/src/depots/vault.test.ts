import { describe, expect, it, vi } from 'vitest';
import { readVault } from './vault.ts';

function file(name: string, text: string, path = name) {
  const f = new File([text], name);
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

describe('readVault', () => {
  it('keeps the Markdown files under their relative path and counts the others', async () => {
    const v = await readVault([
      file('a.md', '# A', 'Coffre/a.md'),
      file('b.MD', 'B', 'Coffre/sous/b.MD'),
      file('image.png', 'x', 'Coffre/image.png'),
    ]);
    expect(v.files).toEqual([
      { path: 'Coffre/a.md', text: '# A' },
      { path: 'Coffre/sous/b.MD', text: 'B' },
    ]);
    expect(v.skipped).toBe(1);
    expect(v.tooBig).toBe(false);
  });

  it('flags a vault above 20 000 000 characters', async () => {
    const v = await readVault([file('a.md', 'x'.repeat(20_000_001))]);
    expect(v.tooBig).toBe(true);
  });

  it('refuses a huge vault by its size, before reading any file', async () => {
    const huge = file('a.md', 'x');
    Object.defineProperty(huge, 'size', { value: 60_000_001 });
    const text = vi.spyOn(huge, 'text');
    expect((await readVault([huge])).tooBig).toBe(true);
    expect(text).not.toHaveBeenCalled();
  });

  it('flags a vault above 2 000 files', async () => {
    const many = Array.from({ length: 2001 }, (_, i) => file(`n${i}.md`, ''));
    expect((await readVault(many)).tooBig).toBe(true);
  });
});
