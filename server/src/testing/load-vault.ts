import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, 'vault');

/** The fictional test vault as `{ path, text }` files. */
export const vault = readdirSync(dir, { recursive: true, encoding: 'utf8' })
  .filter((p) => p.endsWith('.md'))
  .map((p) => ({ path: p.replaceAll('\\', '/'), text: readFileSync(join(dir, p), 'utf8') }));
