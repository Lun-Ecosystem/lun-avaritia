import { formatCost } from '../format.ts';
import type { ServiceState } from '../lib/ui/types.ts';

/** What the rail knows of the service: its pause, its health, its keys and the month's spend. */
export interface ServiceStatus {
  held: boolean;
  paused: boolean;
  degraded: boolean;
  /**
   * Nothing is processed, the deposits wait: the server needs a model for the tri and one for the agent. `no-key`:
   * no key at all; `no-model`: a key, but a model missing for one of the two uses. Unknown until read.
   */
  stopped?: 'no-key' | 'no-model' | false | undefined;
  spend?: { spent: number; cap: number } | undefined;
}

/** The service card of the rail: a pause first, then a degraded service, then a processing stopped. */
export function serviceCard(status: ServiceStatus): { state: ServiceState; title?: string; detail: string } {
  const spend = status.spend ? `${formatCost(status.spend.spent)} sur ${formatCost(status.spend.cap)}` : '';
  if (status.held) return { state: 'pause', detail: spend };
  if (status.degraded) return { state: 'cle-refusee', detail: spend };
  if (status.stopped)
    return {
      state: 'pause',
      title: 'Traitement à l’arrêt',
      detail: status.stopped === 'no-key' ? 'Aucune clé de fournisseur d’IA' : 'Aucun modèle choisi',
    };
  return { state: 'actif', detail: spend };
}
