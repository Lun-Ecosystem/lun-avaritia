<script lang="ts">
  import { getContext } from 'svelte';
  import type { Api } from '../api.ts';
  import { formatCost, formatDuration, formatWhen } from '../format.ts';
  import { Badge, Banner, EmptyState, icons, ListRow, SettingsCard, Skeleton } from '../lib/ui/index.ts';

  interface Dashboard {
    lastRun?: { at: string; durationMs: number; cost: number; observations: number; drafts: number };
    pending: { drafts: number; contradictions: number; doublons: number };
    heldLots: number;
    monthSpend: number;
    recent: { at: string; what: string }[];
  }

  const api = getContext<Api>('api');
  const now = new Date();
  let data = $state<Dashboard | null>(null);
  let failure = $state<string | null>(null);

  api
    .get<Dashboard>('/api/dashboard')
    .then((d) => (data = d))
    .catch((e: Error) => (failure = e.message));

  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
</script>

<div class="ecran" aria-busy={!data && !failure}>
  {#if failure}
    <Banner title="Tableau de bord indisponible">{failure}</Banner>
  {:else if !data}
    <Skeleton height={64} />
    <Skeleton height={96} />
  {:else}
    {@const { lastRun, pending } = data}
    {#if data.heldLots > 0}
      <Banner
        tone="attention"
        title="Plafond de coût atteint : {plural(data.heldLots, 'lot en attente', 'lots en attente')}"
      >
        {#snippet action()}<a href="/reglages">Réglages</a>{/snippet}
      </Banner>
    {/if}

    <SettingsCard title="Dernier traitement">
      {#snippet aside()}<Badge tone="neutre">{formatCost(data!.monthSpend)} ce mois</Badge>{/snippet}
      {#if lastRun}
        <p class="run">
          {formatWhen(lastRun.at, now)} · {formatDuration(lastRun.durationMs)} · {formatCost(lastRun.cost)} ·
          {plural(lastRun.observations, 'observation reçue', 'observations reçues')} ·
          {plural(lastRun.drafts, 'brouillon créé', 'brouillons créés')}
        </p>
      {:else}
        <EmptyState title="Aucun traitement pour l’instant" icon={icons.Clock} />
      {/if}
    </SettingsCard>

    <div class="cartes">
      {#each [{ label: 'Brouillons à valider', n: pending.drafts, href: '/valider' }, { label: 'Contradictions', n: pending.contradictions, href: '/valider?filtre=contradictions' }, { label: 'Doublons probables', n: pending.doublons, href: '/valider?filtre=doublons' }] as c (c.href)}
        <a class="compteur" href={c.href}>
          <span class="n">{c.n}</span>
          <span>{c.label}</span>
        </a>
      {/each}
    </div>

    <SettingsCard title="Activité récente">
      {#each data.recent as r (r.at + r.what)}
        <ListRow>{r.what} <span class="when">{formatWhen(r.at, now)}</span></ListRow>
      {:else}
        <EmptyState title="Rien pour l’instant" icon={icons.Inbox} />
      {/each}
    </SettingsCard>
  {/if}
</div>

<style>
  .ecran {
    display: grid;
    gap: 16px;
    padding: 24px;
  }
  .run {
    margin: 0;
    padding: 14px 18px;
    color: var(--texte-2);
  }
  .cartes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .compteur {
    display: grid;
    gap: 4px;
    padding: 16px 18px;
    background: var(--surface-1);
    border: 1px solid var(--bordure);
    border-radius: var(--r-3);
    color: var(--texte);
    text-decoration: none;
  }
  .compteur:hover {
    background: var(--survol);
  }
  .n {
    font-size: 28px;
  }
  .when {
    float: right;
    color: var(--texte-2);
  }
  @media (max-width: 759.98px) {
    .cartes {
      grid-template-columns: 1fr;
    }
  }
</style>
