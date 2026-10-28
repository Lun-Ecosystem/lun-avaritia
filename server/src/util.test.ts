import { describe, expect, it, vi } from 'vitest';
import { startLoop } from './util.ts';

describe('startLoop', () => {
  it('runs at once, never twice at a time, and keeps going after an error', async () => {
    let release: () => void = () => {};
    const run = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockRejectedValueOnce(new Error('Google 503'))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const loop = startLoop(run, { intervalMs: 3_600_000, onError });
    expect(run).toHaveBeenCalledTimes(1);
    const second = loop.runNow(); // still running: joins the first
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await second;
    await loop.runNow();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Google 503' }));
    await loop.runNow();
    expect(run).toHaveBeenCalledTimes(3);
    loop.stop();
  });
});
