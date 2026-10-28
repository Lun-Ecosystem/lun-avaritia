import { IdSchema, neighborsAction, readAction, SearchSchema, searchAction } from '../brain/agent.ts';
import { IngestSchema, ingestLot, runPending } from '../brain/ingest.ts';
import type { BrainDeps } from '../brain/process.ts';
import type { ActionRegistry } from './actions.ts';

/** The actions Avaritia offers to the core. */
export function registerCatalog(actions: ActionRegistry, deps: BrainDeps, log: (line: string) => void): void {
  actions.register(
    'brain.ingest',
    'Reçoit le lot de la nuit : des observations à trier en brouillons de fiches.',
    IngestSchema,
    async (input) => {
      const result = ingestLot(deps, input.observations);
      // Not awaited: the core gets its answer now, the pass runs on.
      runPending(deps).catch((err) => log(`Traitement du lot : ${err instanceof Error ? err.message : err}`));
      return result;
    },
    'write',
  );
  actions.register(
    'brain.search',
    'Cherche des fiches par mots-clés (20 au plus) ; extraits de 300 caractères.',
    SearchSchema,
    async (input) => searchAction(input, deps),
    'read',
  );
  actions.register(
    'brain.read',
    'Lit une fiche : synthèse (4 000 caractères au plus), faits actifs sourcés, liens. Une fiche fusionnée renvoie la fiche gardée.',
    IdSchema,
    async (input) => readAction(input, deps),
    'read',
  );
  actions.register(
    'brain.neighbors',
    'Les fiches liées à une fiche, avec la relation et le sens.',
    IdSchema,
    async (input) => neighborsAction(input, deps),
    'read',
  );
}
