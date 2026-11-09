<script lang="ts">
  import { getContext } from 'svelte';
  import type { Api } from '../api.ts';
  import { kindOf, type DraftPayload } from '../valider/drafts.ts';
  import { formatCost, formatDuration, formatWhen } from '../format.ts';
  import {
    Badge,
    Banner,
    Button,
    EmptyState,
    icons,
    ListRow,
    SettingsCard,
    Skeleton,
    StatCard,
    toast,
  } from '../lib/ui/index.ts';

  type Line = { at: string; what: string };
  interface Dashboard {
    lastRun?: { at: string; durationMs: number; cost: number; observations: number; drafts: number };
    pending: { drafts: number; contradictions: number; doublons: number };
    heldLots: number;
    recent: Line[];
    recentMore?: boolean;
  }
  interface QueueDraft {
    id: number;
    card: { title: string };
    payload: DraftPayload;
    createdAt: string;
  }

  const api = getContext<Api>('api');
  const now = new Date();
  let data = $state<Dashboard | null>(null);
  let night = $state<QueueDraft[]>([]);
  let failure = $state<string | null>(null);

  // The last run carries no lot number: its drafts are those created since it started.
  Promise.all([api.get<Dashboard>('/api/dashboard'), api.get<{ drafts: QueueDraft[] }>('/api/drafts')])
    .then(([d, q]) => {
      const since = d.lastRun ? Date.parse(d.lastRun.at) - d.lastRun.durationMs : Infinity;
      night = q.drafts.filter((x) => Date.parse(x.createdAt) >= since);
      data = d;
    })
    .catch((e: Error) => (failure = e.message));

  const RESUME = 5;
  let plus = $state<Line[]>([]);
  let suite = $state<boolean | null>(null);
  let chargement = $state(false);
  const lignes = $derived([...(data?.recent ?? []), ...plus]);
  const encore = $derived(suite ?? data?.recentMore ?? false);

  async function voirPlus() {
    chargement = true;
    try {
      const page = await api.get<{ items: Line[]; more: boolean }>(`/api/activity?offset=${lignes.length}`);
      // A new event shifts the pages: a line already shown does not come back.
      const vues = new Set(lignes.map((r) => r.at + r.what));
      plus = [...plus, ...page.items.filter((r) => !vues.has(r.at + r.what))];
      suite = page.more;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'L’activité ne s’est pas chargée.', { tone: 'danger' });
    } finally {
      chargement = false;
    }
  }

  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  const paris = (d: Date, o: Intl.DateTimeFormatOptions) =>
    d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', ...o });
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
        {#snippet action()}<a href="/reglages?theme=fournisseurs">Réglages</a>{/snippet}
      </Banner>
    {/if}

    <header class="entete">
      <h1>{lastRun ? 'Dernier traitement' : 'Aucun traitement pour l’instant'}</h1>
      {#if lastRun}
        <span class="muted">
          traité à {paris(new Date(lastRun.at), { hour: '2-digit', minute: '2-digit' })}, {formatDuration(
            lastRun.durationMs,
          )}, {formatCost(lastRun.cost)}
        </span>
      {/if}
    </header>

    <div class="grille">
      <StatCard
        label="Brouillons à valider"
        value={pending.drafts}
        sub={night.length > 0 ? `dont ${night.length} du dernier traitement` : undefined}
        href="/valider"
        action="Passer en revue"
        primary
      />
      <StatCard
        label="Contradictions"
        value={pending.contradictions}
        tone={pending.contradictions > 0 ? 'danger' : 'neutre'}
        sub="une décision attendue sur chacune"
        href="/valider?filtre=contradictions"
        action="Trancher"
      />
      <StatCard
        label="Doublons probables"
        value={pending.doublons}
        sub="fusion proposée"
        href="/valider?filtre=doublons"
        action="Voir"
      />
    </div>

    <div class="deux">
      <SettingsCard title="Résumé">
        {#if lastRun}
          <p class="phrase">
            {plural(lastRun.observations, 'observation reçue', 'observations reçues')}, {plural(
              lastRun.drafts,
              'brouillon créé',
              'brouillons créés',
            )}.
          </p>
          {#each night.slice(0, RESUME) as d (d.id)}
            {@const t = kindOf(d.payload)}
            <ListRow
              ><div class="ligne">
                <span>{d.card.title}</span>
                <Badge tone={t.tone}>{t.label}</Badge>
              </div></ListRow
            >
          {/each}
          {#if night.length > RESUME}
            <div class="suite">
              <Button variant="fantome" size="petit" href="/valider">
                {night.length - RESUME > 1 ? `Voir les ${night.length - RESUME} autres` : 'Voir l’autre'}
              </Button>
            </div>
          {/if}
        {:else}
          <EmptyState title="Rien pour l’instant" icon={icons.Clock} />
        {/if}
      </SettingsCard>

      <SettingsCard title="Activité récente">
        {#each lignes as r (r.at + r.what)}
          <ListRow><span class="muted when">{formatWhen(r.at, now)}</span> <span>{r.what}</span></ListRow>
        {:else}
          <EmptyState title="Rien pour l’instant" icon={icons.Inbox} />
        {/each}
        {#if encore}
          <div class="suite">
            <Button variant="fantome" size="petit" loading={chargement} onclick={voirPlus}>Voir plus</Button>
          </div>
        {/if}
      </SettingsCard>
    </div>
  {/if}
</div>

<style>
  .ecran {
    display: grid;
    gap: 16px;
    padding: 24px;
  }
  .entete {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 4px 16px;
  }
  h1 {
    margin: 0;
    font: 400 26px/1.2 var(--serif);
    font-variant-numeric: lining-nums;
  }
  .muted {
    color: var(--texte-2);
    font-size: 12.5px;
  }
  .grille {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
  .deux {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 14px;
    align-items: start;
  }
  .phrase {
    margin: 0;
    padding: 12px 18px;
    color: var(--texte-2);
  }
  .ligne {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .suite {
    padding: 8px 18px 12px;
  }
  .when {
    display: inline-block;
    min-width: 72px;
  }
  @media (max-width: 767.98px) {
    .grille,
    .deux {
      grid-template-columns: 1fr;
    }
  }
</style>
