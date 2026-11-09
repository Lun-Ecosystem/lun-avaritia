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

/** The service card of the rail: a pause first, then a degraded service, the cap reached, a processing stopped. */
export function serviceCard(status: ServiceStatus): { state: ServiceState; title?: string; detail: string } {
  const spend = status.spend ? `${formatCost(status.spend.spent)} sur ${formatCost(status.spend.cap)}` : '';
  // A pause holds the lots; a depot, asked by hand, still goes through (server inputs.ts).
  if (status.held) return { state: 'pause', title: 'Lots en pause', detail: 'Les dépôts passent' };
  if (status.degraded) return { state: 'cle-refusee', detail: spend };
  // The server's own test (overCap): the lots and the depots wait for the next month, or a higher cap.
  if (status.spend && status.spend.spent >= status.spend.cap)
    return { state: 'pause', title: 'Plafond atteint', detail: spend };
  if (status.stopped)
    return {
      state: 'pause',
      title: 'Traitement à l’arrêt',
      detail: status.stopped === 'no-key' ? 'Aucune clé de fournisseur d’IA' : 'Aucun modèle choisi',
    };
  return { state: 'actif', detail: spend };
}
