import { describe, expect, it } from 'vitest';
import { SATELLITE } from './index.ts';

describe('satellite identity', () => {
  it('names the satellite as in the lun-docs registry', () => {
    expect(SATELLITE).toEqual({ id: 'lunavaritia', nom: "Lun'Avaritia" });
  });
});
