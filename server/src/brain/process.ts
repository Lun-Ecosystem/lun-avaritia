import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { recordCost } from '../contract/costs.ts';
import { addDegraded, clearDegraded } from '../contract/state.ts';
import { keyRefused, keyWorks } from '../llm/keys.ts';
import { setting } from './settings.ts';
import { costOf, priceOf } from '../llm/models.ts';
import { ProviderError, type LlmProvider, type ProviderId } from '../llm/types.ts';
import type { Fiche, Source } from '../types.ts';
import { parisDay, parisMonthStart } from '../util.ts';
import { addDraft, type DraftPayload } from './drafts.ts';
import { AGENT_SYSTEM, block, TRI_SYSTEM } from './prompt.ts';
import { getFiche, listTypes, searchFiches } from './store.ts';

export interface Observation {
  text: string;
  source: Source;
}

export interface BrainDeps {
  db: DatabaseSync;
  clock: () => Date;
  provider: (use: 'tri' | 'agent') => { provider: LlmProvider; model: string } | undefined;
  /** Where a provider failure is told in full (the result only carries its kind). */
  log?: ((line: string) => void) | undefined;
}

/**
 * `done`: drafts written. `pending`: nothing written, the lot waits for the next pass (`cost-cap`, no
 * provider configured, or a provider failure other than a bad answer). `failed`: an answer still invalid
 * after its retry; `reason` is for the user. `cost` is what the pass paid, in dollars.
 */
export type ProcessResult =
  | { status: 'done'; drafts: number; questions: number; cost: number }
  | {
      status: 'pending';
      reason: 'cost-cap' | 'no-provider' | `provider-${Exclude<ProviderError['kind'], 'format'>}`;
      cost: number;
    }
  | { status: 'failed'; reason: string; cost: number };

const MAX_QUESTIONS = 5;

/** Dollars spent since the Paris month started. */
export function monthSpend(db: DatabaseSync, now: Date): number {
  return (
    db
      .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM costs WHERE at >= ?')
      .get(parisMonthStart(now).toISOString()) as { total: number }
  ).total;
}

export const overCap = (db: DatabaseSync, now: Date) => monthSpend(db, now) >= setting(db, 'cost.monthlyCap');

/** A provider call failed: a refused key or an exhausted credit reaches the health and the events. */
export function providerFailed(
  db: DatabaseSync,
  providerId: ProviderId,
  err: ProviderError,
  now: Date,
): void {
  if (err.kind === 'key') keyRefused(db, providerId, now);
  else if (err.kind === 'credit') addDegraded(db, 'credit');
}

/** A provider call went through: the refusal and the credit alert, if any, are over. */
export function providerWorked(db: DatabaseSync, providerId: ProviderId, now: Date): void {
  keyWorks(db, providerId, now);
  clearDegraded(db, 'credit');
}

const norm = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Same normalized title, or one contained in the other as whole words (« Client X » / « Client X SAS »). */
function closeTitles(a: string, b: string): boolean {
  const [x, y] = [norm(a), norm(b)];
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return x === y || (short.length >= 3 && ` ${long} `.includes(` ${short} `));
}

type Candidate = { id: number; title: string; type: string; excerpt: string };

/** Fiches that may be the subject of an observation: each significant word is searched on its own. */
function candidatesFor(db: DatabaseSync, texts: string[]): Candidate[] {
  const found = new Map<number, Candidate>();
  for (const text of texts) {
    const words = [...new Set(text.match(/[\p{L}\p{N}]{4,}/gu) ?? [])].slice(0, 12);
    for (const w of words) for (const c of searchFiches(db, w, 3)) found.set(c.id, c);
  }
  return [...found.values()].slice(0, 30);
}

const isInt = (n: number) => Number.isInteger(n);
const short = (s: string, max: number) => s.trim().length > 0 && s.length <= max;

// Shapes given to the model as JSON Schema: strict objects, plain types; the bounds and ids are
// checked in `superRefine`, which stays out of the schema the providers receive.
const TriShape = z.strictObject({
  groups: z.array(
    z.strictObject({
      observations: z.array(z.number()),
      ficheId: z.number().nullable(),
      typeId: z.number(),
      title: z.string(),
    }),
  ),
});
type TriOut = z.infer<typeof TriShape>;

const AgentShape = z.strictObject({
  fiches: z.array(
    z.strictObject({
      group: z.number(),
      synthesis: z.string(),
      facts: z.array(
        z.strictObject({ text: z.string(), observation: z.number(), replaces: z.number().nullable() }),
      ),
      links: z.array(z.strictObject({ to: z.string(), relation: z.string() })),
    }),
  ),
  questions: z.array(
    // A plain union (`anyOf`): Anthropic structured outputs refuse the `oneOf` of a discriminated one.
    z.union([
      z.strictObject({
        kind: z.literal('contradiction'),
        ficheId: z.number(),
        keep: z.number(),
        strike: z.number(),
        reason: z.string(),
      }),
      z.strictObject({ kind: z.literal('doublon'), keep: z.number(), merge: z.number(), reason: z.string() }),
    ]),
  ),
});
type AgentOut = z.infer<typeof AgentShape>;

type Group = { observations: number[]; fiche?: Fiche; typeId: number; title: string };

function triSchema(n: number, candidates: Set<number>, types: Set<number>) {
  return TriShape.superRefine((out, ctx) => {
    const seen = new Set<number>();
    for (const g of out.groups) {
      if (!g.observations.length) ctx.addIssue('groupe vide');
      for (const i of g.observations) {
        if (!isInt(i) || i < 0 || i >= n || seen.has(i))
          ctx.addIssue(`observation ${i} invalide ou en double`);
        seen.add(i);
      }
      if (g.ficheId !== null && !candidates.has(g.ficheId)) ctx.addIssue(`fiche ${g.ficheId} inconnue`);
      if (g.ficheId === null && !types.has(g.typeId)) ctx.addIssue(`type ${g.typeId} inconnu`);
      if (g.ficheId === null && !short(g.title, 120)) ctx.addIssue('titre vide ou trop long');
    }
  });
}

function agentSchema(groups: Group[], pairs: [number, number][]) {
  return AgentShape.superRefine((out, ctx) => {
    const done = new Set<number>();
    for (const f of out.fiches) {
      const g = groups[f.group];
      if (!g || done.has(f.group)) {
        ctx.addIssue(`groupe ${f.group} inconnu ou en double`);
        continue;
      }
      done.add(f.group);
      if (f.synthesis.length > 4000) ctx.addIssue('synthèse trop longue');
      if (!f.facts.length) ctx.addIssue(`groupe ${f.group} sans fait`);
      const active = new Set(g.fiche?.facts.filter((x) => !x.struckAt).map((x) => x.id));
      for (const x of f.facts) {
        if (!short(x.text, 300) || x.text.includes('\n'))
          ctx.addIssue('un fait tient en une phrase non vide');
        if (!g.observations.includes(x.observation)) ctx.addIssue(`source ${x.observation} hors du groupe`);
        if (x.replaces !== null && !active.delete(x.replaces))
          ctx.addIssue(`fait remplacé ${x.replaces} absent de la fiche ou déjà remplacé`);
      }
      for (const l of f.links)
        if (!short(l.to, 120) || !short(l.relation, 60)) ctx.addIssue('lien vide ou trop long');
    }
    for (const q of out.questions) {
      if (!short(q.reason, 300)) ctx.addIssue('raison vide ou trop longue');
      if (q.kind === 'contradiction') {
        const fiche = groups.find((g) => g.fiche?.id === q.ficheId)?.fiche;
        const active = new Set(fiche?.facts.filter((x) => !x.struckAt).map((x) => x.id));
        if (q.keep === q.strike || !active.has(q.keep) || !active.has(q.strike))
          ctx.addIssue(`contradiction sur des faits inconnus (${q.keep}, ${q.strike})`);
      } else if (!pairs.some(([a, b]) => (a === q.keep && b === q.merge) || (a === q.merge && b === q.keep)))
        ctx.addIssue(`doublon non proposé (${q.keep}, ${q.merge})`);
    }
  });
}

class InvalidAnswer extends Error {}

/** One JSON call, validated; an invalid answer is retried once. Every call is paid and recorded. */
async function ask<T>(
  deps: BrainDeps,
  use: 'tri' | 'agent',
  choice: { provider: LlmProvider; model: string },
  req: { system: string; user: string; maxTokens: number },
  schema: z.ZodType<T>,
  paid: { cost: number },
): Promise<T> {
  const jsonSchema = z.toJSONSchema(schema) as object;
  let reason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    let value: unknown;
    // The retry says what was wrong; `reason` holds only our own checks' messages, never data.
    const user = attempt
      ? `${req.user}\n\nTa réponse précédente était invalide : ${reason.slice(0, 300)}`
      : req.user;
    try {
      const res = await choice.provider.json({ ...req, user, model: choice.model, schema: jsonSchema });
      const price = priceOf(deps.db, choice.provider.id, choice.model);
      const amount = price ? costOf(price, res.usage) : 0;
      recordCost(
        deps.db,
        { provider: choice.provider.id, model: choice.model, amount, calls: 1 },
        deps.clock(),
        use,
      );
      paid.cost += amount;
      providerWorked(deps.db, choice.provider.id, deps.clock());
      value = res.value;
    } catch (err) {
      if (err instanceof ProviderError) providerFailed(deps.db, choice.provider.id, err, deps.clock());
      if (err instanceof ProviderError && err.kind === 'format') {
        reason = err.message;
        continue;
      }
      throw err;
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    reason = parsed.error.issues.map((i) => i.message).join(' ; ');
  }
  const step = use === 'tri' ? 'du tri' : 'de la rédaction';
  throw new InvalidAnswer(`Réponse invalide ${step}, deux fois : ${reason}`.slice(0, 500));
}

const SPOKEN = new Set<Source['kind']>(['note', 'core']);

/** Two calls: the tri groups the observations, the agent drafts a fiche per group and a few questions. */
export async function processLot(
  deps: BrainDeps,
  observations: Observation[],
  origin: { lot?: number; source: Source['kind'] },
): Promise<ProcessResult> {
  const { db } = deps;
  const paid = { cost: 0 };
  if (!observations.length) return { status: 'done', drafts: 0, questions: 0, cost: 0 };
  if (overCap(db, deps.clock())) return { status: 'pending', reason: 'cost-cap', cost: 0 };
  const tri = deps.provider('tri');
  const agent = deps.provider('agent');
  if (!tri || !agent) return { status: 'pending', reason: 'no-provider', cost: 0 };

  try {
    const types = listTypes(db);
    const candidates = candidatesFor(
      db,
      observations.map((o) => o.text),
    );
    const triOut: TriOut = await ask(
      deps,
      'tri',
      tri,
      {
        system: TRI_SYSTEM,
        user: [
          block('types', types),
          block('fiches', candidates),
          block(
            'observations',
            observations.map((o, i) => ({ index: i, text: o.text })),
          ),
        ].join('\n\n'),
        maxTokens: 2000,
      },
      triSchema(observations.length, new Set(candidates.map((c) => c.id)), new Set(types.map((t) => t.id))),
      paid,
    );

    // shortcut: the cap is checked between the two calls only, so one pass with a large depot may overrun it by its own calls; add a per-chunk check if depots get big.
    if (overCap(db, deps.clock())) return { status: 'pending', reason: 'cost-cap', cost: paid.cost };
    const groups = groupsOf(db, triOut);
    const pairs = duplicatePairs(db, groups);
    const agentOut: AgentOut = await ask(
      deps,
      'agent',
      agent,
      {
        system: AGENT_SYSTEM,
        user: [
          block(
            'groupes',
            groups.map((g, i) => ({
              group: i,
              fiche: g.fiche
                ? {
                    id: g.fiche.id,
                    title: g.fiche.title,
                    synthesis: g.fiche.synthesis,
                    facts: g.fiche.facts.filter((f) => !f.struckAt).map((f) => ({ id: f.id, text: f.text })),
                  }
                : { nouvelle: true, title: g.title },
            })),
          ),
          block(
            'observations',
            groups.flatMap((g, i) =>
              g.observations.map((o) => ({
                group: i,
                index: o,
                // A note or a message is dated when said; a deposit or an import only when it arrived.
                ...(SPOKEN.has(observations[o]!.source.kind) && {
                  date: parisDay(observations[o]!.source.at),
                }),
                text: observations[o]!.text,
              })),
            ),
          ),
          block(
            'doublons',
            pairs.map(([a, b]) => ({ a, b })),
          ),
        ].join('\n\n'),
        maxTokens: 8000,
      },
      agentSchema(groups, pairs),
      paid,
    );

    const drafts: DraftPayload[] = agentOut.fiches.map((f) => {
      const g = groups[f.group]!;
      return {
        kind: 'fiche',
        ...(g.fiche && { ficheId: g.fiche.id }),
        typeId: g.typeId,
        title: g.title,
        synthesis: f.synthesis,
        facts: f.facts.map((x) => ({
          text: x.text.trim(),
          source: observations[x.observation]!.source,
          ...(x.replaces !== null && { replaces: x.replaces }),
        })),
        links: f.links.map((l) => ({ to: l.to.trim(), relation: l.relation.trim() })),
      };
    });
    const asked = askedBefore(db);
    // Over the cap, contradictions go first (the stable sort keeps the model's order otherwise).
    const questions = agentOut.questions
      .sort((a, b) => Number(a.kind !== 'contradiction') - Number(b.kind !== 'contradiction'))
      .filter((q) => !asked.has(questionKey(q)) && asked.add(questionKey(q)))
      .slice(0, MAX_QUESTIONS);
    const now = deps.clock().toISOString();
    db.exec('BEGIN');
    try {
      for (const p of [...drafts, ...questions]) addDraft(db, p, origin, now);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { status: 'done', drafts: drafts.length, questions: questions.length, cost: paid.cost };
  } catch (err) {
    if (err instanceof InvalidAnswer) return { status: 'failed', reason: err.message, cost: paid.cost };
    if (err instanceof ProviderError) {
      deps.log?.(`Traitement : fournisseur ${err.kind} : ${err.message}`.slice(0, 1000));
      return {
        status: 'pending',
        reason: `provider-${err.kind as Exclude<ProviderError['kind'], 'format'>}`,
        cost: paid.cost,
      };
    }
    throw err;
  }
}

/** The code, not the model, makes one group per fiche: same target or same normalized new title. */
function groupsOf(db: DatabaseSync, out: TriOut): Group[] {
  const byKey = new Map<string, Group>();
  for (const g of out.groups) {
    let fiche = g.ficheId === null ? undefined : getFiche(db, g.ficheId);
    if (!fiche) {
      // A new fiche whose title already exists is that fiche.
      const same = searchFiches(db, g.title, 5).find((c) => norm(c.title) === norm(g.title));
      fiche = same && getFiche(db, same.id);
    }
    const key = fiche ? `f${fiche.id}` : `n${norm(g.title)}`;
    const group = byKey.get(key);
    if (group) group.observations.push(...g.observations);
    else
      byKey.set(key, {
        observations: [...g.observations],
        ...(fiche && { fiche }),
        typeId: fiche?.typeId ?? g.typeId,
        title: fiche?.title ?? g.title.trim(),
      });
  }
  return [...byKey.values()];
}

/** Probable duplicates of the targeted fiches, found by the code; the agent only confirms them. */
function duplicatePairs(db: DatabaseSync, groups: Group[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (const { fiche } of groups) {
    if (!fiche) continue;
    for (const c of searchFiches(db, fiche.title, 5))
      if (c.id !== fiche.id && closeTitles(c.title, fiche.title)) pairs.push([fiche.id, c.id]);
  }
  return pairs;
}

const questionKey = (q: AgentOut['questions'][number]) =>
  q.kind === 'contradiction'
    ? `c${Math.min(q.keep, q.strike)}-${Math.max(q.keep, q.strike)}`
    : `d${Math.min(q.keep, q.merge)}-${Math.max(q.keep, q.merge)}`;

/** A question already asked (pending or decided) never comes back. */
function askedBefore(db: DatabaseSync): Set<string> {
  const rows = db.prepare("SELECT payload FROM drafts WHERE kind IN ('contradiction', 'doublon')").all() as {
    payload: string;
  }[];
  return new Set(rows.map((r) => questionKey(JSON.parse(r.payload) as AgentOut['questions'][number])));
}
