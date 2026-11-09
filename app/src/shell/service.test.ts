import { describe, expect, it } from 'vitest';
import { serviceCard } from './service.ts';

const base = { held: false, paused: false, degraded: false, spend: { spent: 1.2, cap: 5 } };
const spend = `${(1.2).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} $ sur ${(5).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} $`;

describe('serviceCard', () => {
  it('is active with the month’s spend while the server can process, or before it is read', () => {
    expect(serviceCard({ ...base, stopped: false })).toEqual({ state: 'actif', detail: spend });
    expect(serviceCard(base)).toEqual({ state: 'actif', detail: spend });
  });

  it('says the processing is stopped when there is no key at all', () => {
    expect(serviceCard({ ...base, stopped: 'no-key' })).toEqual({
      state: 'pause',
      title: 'Traitement à l’arrêt',
      detail: 'Aucune clé de fournisseur d’IA',
    });
  });

  it('says the processing is stopped while a model is missing for the tri or the agent', () => {
    expect(serviceCard({ ...base, stopped: 'no-model' })).toEqual({
      state: 'pause',
      title: 'Traitement à l’arrêt',
      detail: 'Aucun modèle choisi',
    });
  });

  it('in a pause, local or of the core, says the lots wait and the depots go through', () => {
    const paused = { state: 'pause', title: 'Lots en pause', detail: 'Les dépôts passent' };
    expect(serviceCard({ ...base, held: true, paused: true })).toEqual(paused);
    expect(serviceCard({ ...base, held: true, paused: false })).toEqual(paused);
  });

  it('puts a pause, then a degraded service, before the stop', () => {
    expect(serviceCard({ ...base, held: true, stopped: 'no-key' })).toMatchObject({ title: 'Lots en pause' });
    expect(serviceCard({ ...base, degraded: true, stopped: 'no-model' })).toEqual({
      state: 'cle-refusee',
      detail: spend,
    });
  });

  it('says the cap reached once the month’s spend reaches it, after a pause and a degraded service', () => {
    const full = { spent: 5, cap: 5 };
    const words = `${(5).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} $`;
    expect(serviceCard({ ...base, spend: full })).toEqual({
      state: 'pause',
      title: 'Plafond atteint',
      detail: `${words} sur ${words}`,
    });
    expect(serviceCard({ ...base, spend: full, held: true })).toMatchObject({ title: 'Lots en pause' });
    expect(serviceCard({ ...base, spend: full, degraded: true })).toEqual({
      state: 'cle-refusee',
      detail: `${words} sur ${words}`,
    });
  });

  it('a spend under the cap says nothing of the cap', () => {
    expect(serviceCard({ ...base, spend: { spent: 4.99, cap: 5 } }).title).toBeUndefined();
  });

  it('says nothing of the spend before it is read', () => {
    expect(serviceCard({ held: false, paused: false, degraded: false })).toEqual({
      state: 'actif',
      detail: '',
    });
  });
});
