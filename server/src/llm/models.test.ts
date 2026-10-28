import { describe, expect, it } from 'vitest';
import { recordCost } from '../contract/costs.ts';
import { makeHarness } from '../testing/harness.ts';
import { costOf, modelsFor, priceOf, spentToday, tierOf, type ModelInfo } from './models.ts';

const model = (output?: number): ModelInfo => ({
  provider: 'openai',
  id: 'x',
  label: 'X',
  tools: true,
  ...(output === undefined ? {} : { price: { input: 1, output } }),
});

describe('tierOf', () => {
  it('marks by output price, and nothing without a price', () => {
    expect(tierOf(model(1.99))).toBe('€');
    expect(tierOf(model(2))).toBe('€€');
    expect(tierOf(model(14.99))).toBe('€€');
    expect(tierOf(model(15))).toBe('€€€');
    expect(tierOf(model())).toBeNull();
  });
});

describe('priceOf and costOf', () => {
  const db = makeHarness().db;

  it('reads the table, and LLM_PRICES overrides it', () => {
    expect(priceOf(db, 'anthropic', 'claude-haiku-5-5', {})).toEqual({ input: 0.1, output: 0.5 });
    const env = { LLM_PRICES: '{"anthropic/claude-haiku-5-5":[1,2],"custom/local":[3,4]}' };
    expect(priceOf(db, 'anthropic', 'claude-haiku-5-5', env)).toEqual({ input: 1, output: 2 });
    expect(priceOf(db, 'custom', 'local', env)).toEqual({ input: 3, output: 4 });
  });

  it('knows no price for an unlisted model, and ignores a broken LLM_PRICES', () => {
    expect(priceOf(db, 'custom', 'local', {})).toBeUndefined();
    expect(priceOf(db, 'custom', 'local', { LLM_PRICES: 'nope' })).toBeUndefined();
  });

  it('prices per million tokens', () => {
    expect(
      costOf({ input: 0.1, output: 0.5 }, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(0.6, 6);
  });
});

describe('modelsFor', () => {
  const db = makeHarness().db;

  it('keeps only configured providers', () => {
    const list = modelsFor(db, 'tri', ['openai']);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((m) => m.provider === 'openai')).toBe(true);
    expect(modelsFor(db, 'tri', [])).toEqual([]);
  });

  it("keeps only tools: true for 'agent'", () => {
    const list = modelsFor(db, 'agent', ['anthropic', 'openai', 'google', 'mistral']);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((m) => m.tools)).toBe(true);
  });
});

describe('spentToday', () => {
  it("sums purpose 'agent' since the start of the Paris day", () => {
    const { db } = makeHarness();
    const item = { provider: 'openai', model: 'm', amount: 0.25, calls: 1 };
    // 2026-11-02 is winter time: the Paris day began at 2026-11-01T23:00Z.
    recordCost(db, item, new Date('2026-11-01T22:59:00Z'), 'agent');
    recordCost(db, item, new Date('2026-11-01T23:30:00Z'), 'agent');
    recordCost(db, item, new Date('2026-11-02T09:00:00Z'), 'agent');
    recordCost(db, item, new Date('2026-11-02T09:00:00Z'), 'tri');
    recordCost(db, item, new Date('2026-11-02T09:00:00Z'));
    expect(spentToday(db, 'agent', new Date('2026-11-02T12:00:00Z'))).toBeCloseTo(0.5, 6);
    expect(spentToday(db, 'tri', new Date('2026-11-02T12:00:00Z'))).toBeCloseTo(0.25, 6);
  });
});
