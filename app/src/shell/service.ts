import { formatCost } from '../format.ts';
import type { ServiceState } from '../lib/ui/types.ts';

/** What the rail knows of the service: its pause, its health, its keys and the month's spend. */
export interface ServiceStatus {
  held: boolean;
  paused: boolean;
  degraded: boolean;
  /** No AI provider key at all: the deposits wait, nothing is processed. Unknown until read. */
  noKey?: boolean | undefined;
  spend?: { spent: number; cap: number } | undefined;
}

/** The service card of the rail: a pause first, then a degraded service, then no key at all. */
export function serviceCard(status: ServiceStatus): { state: ServiceState; title?: string; detail: string } {
  const spend = status.spend ? `${formatCost(status.spend.spent)} sur ${formatCost(status.spend.cap)}` : '';
  if (status.held) return { state: 'pause', detail: spend };
  if (status.degraded) return { state: 'cle-refusee', detail: spend };
  if (status.noKey)
    return { state: 'pause', title: 'Traitement à l’arrêt', detail: 'Aucune clé de fournisseur d’IA' };
  return { state: 'actif', detail: spend };
}
