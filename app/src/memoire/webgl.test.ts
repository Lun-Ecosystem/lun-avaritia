import { describe, expect, it, vi } from 'vitest';
import { hasWebGL } from './webgl.ts';

const canvas = (ctx: unknown) => ({ getContext: vi.fn(() => ctx) }) as unknown as HTMLCanvasElement;

describe('hasWebGL', () => {
  it('says yes and releases the probe context at once', () => {
    const loseContext = vi.fn();
    const ctx = { getExtension: vi.fn(() => ({ loseContext })) };
    expect(hasWebGL(canvas(ctx))).toBe(true);
    expect(ctx.getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('says no without a context', () => {
    expect(hasWebGL(canvas(null))).toBe(false);
  });
});
