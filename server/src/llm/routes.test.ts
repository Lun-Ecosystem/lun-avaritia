import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eventsSince } from '../contract/events.ts';
import { getSetting } from '../db.ts';
import { makeHarness } from '../testing/harness.ts';
import { saveKey } from './keys.ts';
import { MODELS } from './models.ts';

const secretKey = randomBytes(32).toString('base64');

async function api(h: ReturnType<typeof makeHarness>) {
  const token = await h.pairClient();
  return async (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: h.auth(token) };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await h.app.request(`/api/llm${path}`, init);
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) as Record<string, unknown> };
  };
}

describe('/api/llm', () => {
  it('PUT key: refused → 400 and nothing saved', async () => {
    const h = makeHarness({ secretKey });
    const call = await api(h);
    h.keyCheck.result = 'refused';
    const refused = await call('PUT', '/providers/openai/key', { key: 'sk-test-openai-5678' });
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({ error: 'Clé refusée par OpenAI, rien n’a changé' });
    h.keyCheck.result = 'unreachable';
    const unreachable = await call('PUT', '/providers/mistral/key', { key: 'mistral-test-9999' });
    expect(unreachable.status).toBe(502);
    expect(unreachable.body).toEqual({ error: 'Mistral injoignable, rien n’a changé' });
    expect(getSetting(h.db, 'openai.key', null)).toBeNull();
    expect(getSetting(h.db, 'mistral.key', null)).toBeNull();

    h.keyCheck.result = 'ok';
    const ok = await call('PUT', '/providers/google/key', { key: 'gemini-test-4321', expires: '2027-01-31' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      id: 'google',
      label: 'Google Gemini',
      state: 'ok',
      last4: '4321',
      expires: '2027-01-31',
      source: 'saved',
    });
    expect((await call('PUT', '/providers/nope/key', { key: 'x' })).status).toBe(404);
  });

  it('PUT expires changes or clears the declared date of a saved key, without the key', async () => {
    const h = makeHarness({ secretKey, llmEnv: { openai: { key: 'sk-env-openai-1234' } } });
    const call = await api(h);
    // No key at all, then a key from .env: nothing to change here.
    const none = await call('PUT', '/providers/google/expires', { expires: '2026-11-10' });
    expect(none.status).toBe(409);
    expect(none.body).toEqual({ error: 'Aucune clé enregistrée pour Google Gemini' });
    const env = await call('PUT', '/providers/openai/expires', { expires: '2026-11-10' });
    expect(env.status).toBe(409);
    expect(env.body.error).toMatch(/\.env/);
    expect((await call('PUT', '/providers/nope/expires', { expires: null })).status).toBe(404);

    saveKey(h.db, secretKey, 'anthropic', 'sk-ant-test-7f3a', '2027-08-11');
    for (const expires of ['2026-02-30', '11/08/2027', 42]) {
      const bad = await call('PUT', '/providers/anthropic/expires', { expires });
      expect(bad.status, String(expires)).toBe(400);
    }
    expect((await call('PUT', '/providers/anthropic/expires', {})).status).toBe(400);

    // Within 14 days: the warning goes out at once, once.
    const soon = await call('PUT', '/providers/anthropic/expires', { expires: '2026-11-10' });
    expect(soon.status).toBe(200);
    expect(soon.body).toMatchObject({ id: 'anthropic', expires: '2026-11-10', last4: '7f3a', state: 'ok' });
    const expiring = () => eventsSince(h.db).filter((e) => e.type === 'key.expiring');
    expect(expiring()).toHaveLength(1);
    expect(h.keyCheck.calls).toEqual([]);
    // The same date saved again keeps its flags: no second warning.
    await call('PUT', '/providers/anthropic/expires', { expires: '2026-11-10' });
    expect(expiring()).toHaveLength(1);
    expect(getSetting(h.db, 'anthropic.expiryWarned', null)).toEqual([14]);

    const cleared = await call('PUT', '/providers/anthropic/expires', { expires: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).not.toHaveProperty('expires');
    expect(getSetting(h.db, 'anthropic.expiryWarned', null)).toEqual([]);
    // The same date declared again warns again: the flags started over.
    await call('PUT', '/providers/anthropic/expires', { expires: '2026-11-10' });
    expect(expiring()).toHaveLength(2);
  });

  it('custom baseUrl must be http(s), else 400', async () => {
    const h = makeHarness({ secretKey });
    const call = await api(h);
    for (const baseUrl of [
      undefined,
      '',
      'ftp://llm.example.test',
      'file:///etc/passwd',
      'pas une adresse',
      'https://moi:secret@llm.example.test/v1',
    ]) {
      const res = await call('PUT', '/providers/custom/key', { key: 'custom-test-0001', baseUrl });
      expect(res.status, String(baseUrl)).toBe(400);
    }
    expect(h.keyCheck.calls).toEqual([]);
    const ok = await call('PUT', '/providers/custom/key', {
      key: 'custom-test-0001',
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: 'custom', baseUrl: 'http://localhost:11434/v1', last4: '0001' });
    expect(h.keyCheck.calls).toEqual([
      { id: 'custom', key: 'custom-test-0001', baseUrl: 'http://localhost:11434/v1' },
    ]);
    // Removing the key forgets the address too.
    const removed = await call('DELETE', '/providers/custom/key');
    expect(removed.body).toEqual({ id: 'custom', label: 'Point d’accès compatible', state: 'absent' });
    expect(getSetting(h.db, 'custom.baseUrl', null)).toBeNull();
  });

  it('GET /providers never returns more than last4', async () => {
    const env = { openai: { key: 'sk-test-openai-env-ABCD' } };
    const h = makeHarness({ secretKey, llmEnv: env });
    saveKey(h.db, secretKey, 'anthropic', 'sk-ant-test-saved-WXYZ', '2027-02-01');
    const res = await (await api(h))('GET', '/providers');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('sk-ant-test-saved');
    expect(res.text).not.toContain('sk-test-openai-env');
    expect(res.body.providers).toEqual([
      {
        id: 'anthropic',
        label: 'Anthropic',
        state: 'ok',
        last4: 'WXYZ',
        expires: '2027-02-01',
        source: 'saved',
      },
      { id: 'openai', label: 'OpenAI', state: 'ok', last4: 'ABCD', source: 'env' },
      { id: 'google', label: 'Google Gemini', state: 'absent' },
      { id: 'mistral', label: 'Mistral', state: 'absent' },
      { id: 'custom', label: 'Point d’accès compatible', state: 'absent' },
    ]);
  });

  it('PUT /choice rejects a non-tool model for agent', async () => {
    const h = makeHarness({ secretKey });
    saveKey(h.db, secretKey, 'openai', 'sk-test-openai-5678');
    const call = await api(h);
    // No model of the table lacks tool calling today: one is added for the test.
    MODELS.push({ provider: 'openai', id: 'gpt-test-notools', label: 'Sans outils', tools: false });
    try {
      const agentChoice = await call('PUT', '/choice', {
        use: 'agent',
        provider: 'openai',
        model: 'gpt-test-notools',
      });
      expect(agentChoice.status).toBe(400);
      expect(getSetting(h.db, 'llm.agent', null)).toBeNull();
      const triChoice = await call('PUT', '/choice', {
        use: 'tri',
        provider: 'openai',
        model: 'gpt-test-notools',
      });
      expect(triChoice.status).toBe(200);
      expect(getSetting(h.db, 'llm.tri', null)).toEqual({ provider: 'openai', model: 'gpt-test-notools' });
    } finally {
      MODELS.pop();
    }
    // A provider without a key, an unknown use: refused too.
    expect(
      (await call('PUT', '/choice', { use: 'agent', provider: 'anthropic', model: 'claude-haiku-5-5' }))
        .status,
    ).toBe(400);
    expect(
      (await call('PUT', '/choice', { use: 'other', provider: 'openai', model: 'gpt-6-luna' })).status,
    ).toBe(400);
  });

  it('GET /choice computes the default without writing it', async () => {
    const h = makeHarness({ secretKey });
    const call = await api(h);
    expect((await call('GET', '/choice')).body).toEqual({ tri: null, agent: null });
    saveKey(h.db, secretKey, 'anthropic', 'sk-ant-test-0000');
    expect((await call('GET', '/choice')).body).toEqual({
      tri: { provider: 'anthropic', model: 'claude-haiku-5-5' },
      agent: { provider: 'anthropic', model: 'claude-haiku-5-5' },
    });
    expect(getSetting(h.db, 'llm.tri', null)).toBeNull();
    expect(getSetting(h.db, 'llm.agent', null)).toBeNull();
  });

  it('GET /models lists the configured providers, the custom endpoint from its own listing', async () => {
    const listed: string[] = [];
    let fail = false;
    const h = makeHarness({
      secretKey,
      listCustomModels: async (_key, baseUrl) => {
        listed.push(baseUrl);
        if (fail) throw new Error('down');
        return ['llama-test'];
      },
    });
    saveKey(h.db, secretKey, 'mistral', 'mistral-test-9999');
    saveKey(h.db, secretKey, 'custom', 'custom-test-0001', undefined, 'http://localhost:11434/v1');
    const call = await api(h);
    const res = await call('GET', '/models?use=agent');
    expect(res.body.models).toEqual([
      { provider: 'mistral', id: 'mistral-small-latest', label: 'Mistral Small', tools: true, tier: null },
      { provider: 'mistral', id: 'mistral-medium-latest', label: 'Mistral Medium', tools: true, tier: null },
      {
        provider: 'mistral',
        id: 'mistral-large-latest',
        label: 'Mistral Large',
        tools: true,
        price: { input: 0.5, output: 1.5 },
        tier: '€',
      },
      { provider: 'custom', id: 'llama-test', label: 'llama-test', tools: true, tier: null },
    ]);
    expect(listed).toEqual(['http://localhost:11434/v1']);
    // The custom model is a valid choice.
    expect(
      (await call('PUT', '/choice', { use: 'agent', provider: 'custom', model: 'llama-test' })).status,
    ).toBe(200);
    fail = true;
    expect((await call('GET', '/models?use=tri')).body.models).toHaveLength(3);
    expect((await call('GET', '/models?use=other')).status).toBe(400);
  });
});
