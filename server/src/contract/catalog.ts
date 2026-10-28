import { IngestSchema, ingestLot, runPending } from '../brain/ingest.ts';
import type { BrainDeps, Observation } from '../brain/process.ts';
import type { ActionRegistry } from './actions.ts';

/** The actions Avaritia offers to the core. */
export function registerCatalog(actions: ActionRegistry, deps: BrainDeps, log: (line: string) => void): void {
  actions.register(
    'brain.ingest',
    'Reçoit le lot de la nuit : des observations à trier en brouillons de fiches.',
    IngestSchema,
    async (input) => {
      const result = ingestLot(deps, input.observations as Observation[]);
      // Not awaited: the core gets its answer now, the pass runs on.
      runPending(deps).catch((err) => log(`Traitement du lot : ${err instanceof Error ? err.message : err}`));
      return result;
    },
    'write',
  );
}
