import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Nothing listens, nothing is copied, the base is in memory.
vi.mock('@hono/node-server', () => ({ serve: vi.fn() }));
vi.mock('./backup.ts', () => ({ backupIfMissing: vi.fn() }));
vi.mock('./db.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./db.ts')>();
  return { ...real, openDb: vi.fn(() => real.openDb(':memory:')) };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the server', () => {
  it('takes a variable set but empty for an absent one: the default base and the default port', async () => {
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {});
    vi.stubEnv('DB_PATH', '');
    vi.stubEnv('PORT', ' ');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await import('./main.ts');
    const { openDb } = await import('./db.ts');
    const { serve } = await import('@hono/node-server');
    const root = fileURLToPath(new URL('../../', import.meta.url));
    expect(openDb).toHaveBeenCalledWith(resolve(root, 'data/avaritia.db'));
    expect(serve).toHaveBeenCalledWith(expect.objectContaining({ port: 8789 }), expect.anything());
    // Importing the whole server takes seconds, more on a small CI machine.
  }, 30_000);
});
