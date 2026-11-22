import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pair } from '../contract/auth.ts';
import { openDb } from '../db.ts';
import { pairCodeLine } from './pair-code.ts';

const LINE = /^Code d’appairage : (\d{3}) (\d{3}) · expire à (\d{2}:\d{2}) · usage unique$/;

// The command opens its base in memory here: nothing is written under data/.
vi.mock('../db.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../db.ts')>();
  return { ...real, openDb: vi.fn(() => real.openDb(':memory:')) };
});

const argv1 = process.argv[1];
afterEach(() => {
  process.argv[1] = argv1!;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('pair-code', () => {
  it('takes DB_PATH set but empty for an absent one: the default base', async () => {
    vi.resetModules();
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {});
    vi.stubEnv('DB_PATH', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.argv[1] = fileURLToPath(new URL('./pair-code.ts', import.meta.url));
    await import('./pair-code.ts');
    const db = await import('../db.ts');
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    expect(db.openDb).toHaveBeenCalledWith(resolve(root, 'data/avaritia.db'));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(LINE));
  });

  it('pair-code works whether clients exist or not', () => {
    const db = openDb(':memory:');
    const now = new Date('2026-11-02T08:00:00.000Z');
    const first = pairCodeLine(db, now).match(LINE)!;
    expect(first).not.toBeNull();
    expect(pair(db, first[1]! + first[2]!, 'laptop', now)).not.toBeNull();
    const second = pairCodeLine(db, now).match(LINE)!;
    expect(second).not.toBeNull();
    expect(pair(db, second[1]! + second[2]!, 'phone', now)).not.toBeNull();
  });

  it('prints the code grouped by three and its local expiry time', () => {
    const db = openDb(':memory:');
    const now = new Date('2026-11-02T08:00:00.000Z');
    const expiry = new Date('2026-11-02T08:10:00.000Z').toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(pairCodeLine(db, now).match(LINE)?.[3]).toBe(expiry);
  });
});
