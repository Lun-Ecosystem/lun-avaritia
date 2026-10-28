import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { InvalidInputError } from '../contract/actions.ts';
import { recordCost } from '../contract/costs.ts';
import { costOf, priceOf } from '../llm/models.ts';
import { ProviderError, type ChatMessage, type ToolCall } from '../llm/types.ts';
import { cardOf, getDraft, type Card } from './drafts.ts';
import { addNote, InputError } from './inputs.ts';
import { monthSpend, overCap, providerFailed, providerWorked, type BrainDeps } from './process.ts';
import { ASK_SYSTEM, block } from './prompt.ts';
import { getFiche, listTypes, neighbors, searchFiches } from './store.ts';

const MAX_ROUNDS = 6;
const MAX_TOKENS = 4096;
const EXCERPT_CHARS = 300;
const SYNTHESIS_CHARS = 4000;

export const NO_MODEL = 'Aucun modèle choisi pour l’agent : à régler dans Réglages › Fournisseurs d’IA.';
const CAP = 'Plafond de coût mensuel atteint : je ne peux pas répondre avant le mois prochain, ou relève-le.';
const STOPPED = 'Je me suis arrêté : trop d’allers-retours. Voilà ce que je sais, reformule pour continuer.';
const EMPTY = 'Je n’ai rien de clair à répondre là-dessus.';
const FAILED: Record<ProviderError['kind'], string> = {
  key: 'Le fournisseur d’IA refuse la clé : à vérifier dans Réglages.',
  credit: 'Plus de crédit chez le fournisseur d’IA.',
  unavailable: 'Le fournisseur d’IA ne répond pas pour le moment. Réessaie dans un instant.',
  format: 'Le fournisseur d’IA a renvoyé une réponse illisible. Réessaie dans un instant.',
};

export interface AgentReply {
  summary: string;
  cards: Card[];
  refs: { type: 'fiche'; id: string; title: string }[];
  cost: { currency: 'USD'; amount: number };
}

// --- The three reads (also catalog actions) ---------------------------------------------------------

export const SearchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(20).default(10),
});
export const IdSchema = z.object({ id: z.number().int().positive() });

export function searchAction({ query, limit }: z.infer<typeof SearchSchema>, deps: Pick<BrainDeps, 'db'>) {
  return searchFiches(deps.db, query, limit).map((r) => ({
    ...r,
    excerpt: r.excerpt.slice(0, EXCERPT_CHARS),
  }));
}

/** The fiche an id lands on: a merged fiche follows its merges to the kept one. */
export function keptFiche(db: DatabaseSync, id: number) {
  let fiche = getFiche(db, id);
  // The guard stops a (never expected) merge cycle.
  for (let i = 0; fiche?.mergedInto !== undefined && i < 10; i++) fiche = getFiche(db, fiche.mergedInto);
  if (!fiche || fiche.mergedInto !== undefined) throw new InvalidInputError(`Fiche inconnue : ${id}`);
  return fiche;
}

/**
 * The fiche with its active facts only. A fiche merged into another redirects to the kept one (the answer
 * says `redirectedFrom`), so a link to an old id still lands somewhere.
 */
export function readAction({ id }: z.infer<typeof IdSchema>, deps: Pick<BrainDeps, 'db'>) {
  const fiche = keptFiche(deps.db, id);
  const live = (n: number) => getFiche(deps.db, n)?.mergedInto === undefined;
  return {
    id: fiche.id,
    title: fiche.title,
    type: listTypes(deps.db).find((t) => t.id === fiche.typeId)?.name ?? '',
    synthesis: fiche.synthesis.slice(0, SYNTHESIS_CHARS),
    facts: fiche.facts
      .filter((f) => f.struckAt === undefined)
      .map((f) => ({ id: f.id, text: f.text, source: f.source, at: f.at })),
    links: fiche.links.filter((l) => live(l.from) && live(l.to)),
    updatedAt: fiche.updatedAt,
    ...(fiche.id !== id && { redirectedFrom: id }),
  };
}

export function neighborsAction({ id }: z.infer<typeof IdSchema>, deps: Pick<BrainDeps, 'db'>) {
  return neighbors(deps.db, keptFiche(deps.db, id).id);
}

// --- Requests ---------------------------------------------------------------------------------------

// Bounded: the core's context is free-form but small.
export const ContextSchema = z
  .record(z.string().max(100), z.string().max(2000))
  .refine((c) => Object.keys(c).length <= 20, '20 clés au plus');
export const DelegationSchema = z.object({
  request: z.string().min(1).max(4000),
  context: ContextSchema.optional(),
});
// shortcut: no stored chat history in v1, the front sends it back with each request.
export const ChatSchema = DelegationSchema.extend({
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .max(20)
    .optional(),
});

// --- The loop ---------------------------------------------------------------------------------------

const tool = (name: string, description: string, schema: z.ZodType) => ({
  name,
  description,
  input: z.toJSONSchema(schema) as object,
});
const NoteSchema = z.object({ text: z.string().min(1).max(20_000) });
const TOOLS = [
  tool('brain_search', 'Cherche des fiches par mots-clés ; rend id, titre, type, extrait.', SearchSchema),
  tool('brain_read', 'Lit une fiche : synthèse, faits actifs sourcés, liens.', IdSchema),
  tool('brain_neighbors', 'Les fiches liées à une fiche.', IdSchema),
  tool(
    'note',
    'Garde une note de l’utilisateur : crée des brouillons de fiches qu’il validera. Rien n’entre dans les fiches sans lui.',
    NoteSchema,
  ),
];

type Out = { ok: true; result: unknown } | { ok: false; error: string };

export async function ask(
  deps: BrainDeps,
  request: string,
  context?: Record<string, string>,
  history: { role: 'user' | 'assistant'; text: string }[] = [],
): Promise<AgentReply> {
  const { db } = deps;
  const choice = deps.provider('agent');
  const refs = new Map<number, string>();
  // shortcut: cards and cost are deltas since the start, so a concurrent ingest can add its own; tag them by origin if that matters.
  const spent0 = monthSpend(db, deps.clock());
  const lastDraft = (db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM drafts').get() as { n: number }).n;
  const reply = (summary: string): AgentReply => ({
    summary,
    cards: (
      db.prepare('SELECT id FROM drafts WHERE id > ? ORDER BY id').all(lastDraft) as { id: number }[]
    ).map((r) => cardOf(db, getDraft(db, r.id)!)),
    refs: [...refs].map(([id, title]) => ({ type: 'fiche', id: String(id), title })),
    cost: { currency: 'USD', amount: Math.max(0, monthSpend(db, deps.clock()) - spent0) },
  });
  if (!choice) return reply(NO_MODEL);
  if (overCap(db, deps.clock())) return reply(CAP);

  const { provider, model } = choice;
  // The request is the user's own words; the context is data, in a delimited block.
  const user =
    context && Object.keys(context).length ? `${request}\n\n${block('contexte', context)}` : request;
  const messages: ChatMessage[] = [
    ...history.map((m): ChatMessage =>
      m.role === 'user' ? { role: 'user', text: m.text } : { role: 'assistant', text: m.text, toolCalls: [] },
    ),
    { role: 'user', text: user },
  ];

  const run = async (call: ToolCall): Promise<Out> => {
    if (call.invalidArguments !== undefined)
      return { ok: false, error: 'Arguments illisibles : un objet JSON est attendu.' };
    try {
      if (call.name === 'brain_search') {
        const p = SearchSchema.safeParse(call.input);
        return p.success
          ? { ok: true, result: searchAction(p.data, deps) }
          : { ok: false, error: p.error.message };
      }
      if (call.name === 'brain_read' || call.name === 'brain_neighbors') {
        const p = IdSchema.safeParse(call.input);
        if (!p.success) return { ok: false, error: p.error.message };
        if (call.name === 'brain_neighbors') return { ok: true, result: neighborsAction(p.data, deps) };
        const fiche = readAction(p.data, deps);
        refs.set(fiche.id, fiche.title);
        return { ok: true, result: fiche };
      }
      if (call.name === 'note') {
        const p = NoteSchema.safeParse(call.input);
        if (!p.success) return { ok: false, error: p.error.message };
        // A refused or pending pass is an answer for the model, not a failure of the loop.
        return { ok: true, result: await addNote(deps, p.data.text) };
      }
      return { ok: false, error: `Outil inconnu : ${call.name}` };
    } catch (err) {
      if (err instanceof InvalidInputError || err instanceof InputError)
        return { ok: false, error: err.message };
      throw err;
    }
  };

  let last = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // The cap is checked before every call, not only the first.
    if (overCap(db, deps.clock()))
      return reply(
        last
          ? `${last}

${CAP}`
          : CAP,
      );
    let res;
    try {
      res = await provider.chat({ model, system: ASK_SYSTEM, messages, tools: TOOLS, maxTokens: MAX_TOKENS });
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      providerFailed(db, provider.id, err, deps.clock());
      return reply(FAILED[err.kind]);
    }
    providerWorked(db, provider.id, deps.clock());
    const price = priceOf(db, provider.id, model);
    recordCost(
      db,
      { provider: provider.id, model, amount: price ? costOf(price, res.usage) : 0, calls: 1 },
      deps.clock(),
      'agent',
    );
    if (!res.toolCalls.length) return reply(res.text.trim() || EMPTY);
    last = res.text.trim();
    const assistant: ChatMessage = { role: 'assistant', text: res.text, toolCalls: res.toolCalls };
    if (res.replay !== undefined) assistant.replay = res.replay;
    messages.push(assistant);
    for (const call of res.toolCalls) {
      const out = await run(call);
      messages.push({
        role: 'tool',
        callId: call.id,
        content: out.ok ? JSON.stringify(out.result ?? null) : out.error,
        isError: !out.ok,
      });
    }
  }
  return reply(last ? `${last}\n\n${STOPPED}` : STOPPED);
}
