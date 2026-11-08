import { describe, expect, it } from 'vitest';
import { serviceCard } from './service.ts';

const base = { held: false, paused: false, degraded: false, spend: { spent: 1.2, cap: 5 } };
const spend = `${(1.2).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} $ sur ${(5).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} $`;

describe('serviceCard', () => {
  it('is active with the month’s spend while a key is in service, or not read yet', () => {
    expect(serviceCard({ ...base, noKey: false })).toEqual({ state: 'actif', detail: spend });
    expect(serviceCard(base)).toEqual({ state: 'actif', detail: spend });
  });

  it('says the processing is stopped when there is no key at all', () => {
    expect(serviceCard({ ...base, noKey: true })).toEqual({
      state: 'pause',
      title: 'Traitement à l’arrêt',
      detail: 'Aucune clé de fournisseur d’IA',
    });
  });

  it('puts a pause, then a degraded service, before the missing key', () => {
    expect(serviceCard({ ...base, held: true, noKey: true })).toEqual({ state: 'pause', detail: spend });
    expect(serviceCard({ ...base, degraded: true, noKey: true })).toEqual({
      state: 'cle-refusee',
      detail: spend,
    });
  });

  it('says nothing of the spend before it is read', () => {
    expect(serviceCard({ held: false, paused: false, degraded: false })).toEqual({
      state: 'actif',
      detail: '',
    });
  });
});
