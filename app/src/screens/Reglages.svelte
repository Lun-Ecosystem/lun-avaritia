<script lang="ts">
  import { getContext, tick } from 'svelte';
  import type { Api } from '../api.ts';
  import {
    Badge,
    Banner,
    Button,
    ICON_STROKE,
    icons,
    NavLink,
    SettingsCard,
    SettingsRow,
    Skeleton,
    type IconComponent,
  } from '../lib/ui/index.ts';
  import NavGroup from '../lib/ui/NavGroup.svelte';
  import { go } from '../memoire/titles.ts';
  import Agent from '../reglages/Agent.svelte';
  import Appareils from '../reglages/Appareils.svelte';
  import Donnees from '../reglages/Donnees.svelte';
  import Lots from '../reglages/Lots.svelte';
  import { SettingsStore } from '../reglages/settings.svelte.ts';
  import Types from '../reglages/Types.svelte';

  /*
   * Settings, as Lun'Acedia's (plate 06): a column of themes, one page per theme with its cards
   * centered. The address carries the theme (`?theme=`) so that back and forward follow. A problem
   * shows as a banner on top of the page concerned. On a phone, the column is the entry list and a
   * theme opens full screen, with a way back.
   */

  type Props = {
    /** The service paused by hand, as the rail shows it. */
    paused: boolean;
    /** After a pause or a resume: the app reads the service state again. */
    onservice: () => Promise<void>;
    /** `?theme=` of the address. */
    theme?: string | null | undefined;
  };
  let { paused, onservice, theme: asked = null }: Props = $props();

  type Theme = 'appareils' | 'service' | 'fiches' | 'agent' | 'fournisseurs' | 'donnees';
  interface Page {
    id: Theme;
    label: string;
    icon: IconComponent;
    group: string;
    description: string;
    /** Reads the settings: their failure shows on this page. */
    store?: boolean;
  }
  const PAGES: Page[] = [
    {
      id: 'appareils',
      label: 'Appareils et applications',
      icon: icons.Monitor,
      group: 'Compte',
      description: "Ce qui a accès à Lun'Avaritia.",
    },
    {
      id: 'service',
      label: 'Service',
      icon: icons.Pause,
      group: 'Traitement',
      description: 'La pause arrête tout ce qui est automatique : lots, dépôts, appels au modèle.',
    },
    {
      id: 'fiches',
      label: 'Fiches',
      icon: icons.FileText,
      group: 'Traitement',
      description: 'Les types proposés aux brouillons et aux fiches, et ce qu’un lot peut proposer.',
      store: true,
    },
    {
      id: 'agent',
      label: 'Agent',
      icon: icons.Sparkles,
      group: 'IA',
      description: 'Son nom, son apparence et sa voix, jamais ce qu’il a le droit de faire.',
      store: true,
    },
    {
      id: 'fournisseurs',
      label: 'Fournisseurs d’IA',
      icon: icons.Key,
      group: 'IA',
      description:
        'Une clé par fournisseur, jamais affichée en entier ; les modèles des lots et de l’agent ; le plafond de coût du mois.',
      store: true,
    },
    {
      id: 'donnees',
      label: 'Import et export',
      icon: icons.Archive,
      group: 'Données',
      description: 'Ce qui entre (un coffre Obsidian) et ce qui sort (Markdown).',
    },
  ];
  const GROUPS = ['Compte', 'Traitement', 'IA', 'Données'];
  const known = (t: string | null) => PAGES.some((p) => p.id === t);

  // Follows the address (back button, a link of another screen); a click sets them at once.
  let theme = $derived<Theme>(known(asked) ? (asked as Theme) : 'service');
  /** On a phone: a theme is open (else the list of themes shows). */
  let opened = $derived(known(asked));
  const page = $derived(PAGES.find((p) => p.id === theme)!);

  const api = getContext<Api>('api');
  const store = new SettingsStore(api);
  store.load();
  let spend = $state<number | null>(null);
  api
    .get<{ monthSpend: number }>('/api/dashboard')
    .then((d) => (spend = d.monthSpend))
    .catch(() => {});

  let heading = $state<HTMLElement | null>(null);
  let nav = $state<HTMLElement | null>(null);

  /* Changing page moves the focus with it: on a phone, the list and the page replace each other. */
  function open(next: Theme) {
    return async (event: MouseEvent) => {
      event.preventDefault();
      theme = next;
      opened = true;
      go(`/reglages?theme=${next}`);
      await tick();
      heading?.focus();
    };
  }

  async function back() {
    opened = false;
    go('/reglages');
    await tick();
    nav?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
  }

  let switching = $state(false);
  let serviceError = $state<string | null>(null);
  async function toggleService() {
    switching = true;
    serviceError = null;
    try {
      await api.send('POST', paused ? '/lun/v1/resume' : '/lun/v1/pause');
    } catch (e) {
      serviceError = e instanceof Error && e.message ? e.message : 'L’action a échoué.';
    } finally {
      // Even refused (409: already in that state), the rail must show the state of the server.
      await onservice();
      switching = false;
    }
  }
</script>

<div class={['reglages', { ouvert: opened }]}>
  <nav class="themes" aria-label="Thèmes des réglages" bind:this={nav}>
    <h1>Réglages</h1>
    {#each GROUPS as group (group)}
      <NavGroup title={group}>
        <div class="bloc">
          {#each PAGES.filter((p) => p.group === group) as p (p.id)}
            <div class="theme">
              <NavLink
                href="/reglages?theme={p.id}"
                label={p.label}
                icon={p.icon}
                current={theme === p.id}
                onclick={open(p.id)}
              />
              <span class="resume" aria-hidden="true">
                {#if p.id === 'service'}{paused ? 'En pause' : 'Actif'}{/if}
                <icons.ChevronRight size={14} strokeWidth={ICON_STROKE} />
              </span>
            </div>
          {/each}
        </div>
      </NavGroup>
    {/each}
  </nav>

  <div class="contenu">
    <div class="colonne">
      <Button variant="fantome" size="petit" icon={icons.ArrowLeft} class="retour" onclick={back}
        >Réglages</Button
      >
      {#if page.store && store.failure}
        <Banner title="Réglages indisponibles">{store.failure}</Banner>
      {/if}

      <header class="tete">
        <small>{page.group}</small>
        <h2 tabindex="-1" bind:this={heading}>{page.label}</h2>
        <p>{page.description}</p>
      </header>

      {#if theme === 'appareils'}
        <Appareils />
      {:else if theme === 'service'}
        <SettingsCard title="Service">
          {#snippet aside()}
            <Badge tone={paused ? 'attention' : 'ok'} dot>{paused ? 'En pause' : 'Actif'}</Badge>
          {/snippet}
          <SettingsRow
            label="Traitement"
            hint={paused
              ? 'Aucun lot ni dépôt n’est lu, aucun appel au modèle.'
              : 'Les lots et les dépôts sont lus dès leur arrivée.'}
            error={serviceError}
          >
            <Button
              size="petit"
              icon={paused ? icons.Play : icons.Pause}
              loading={switching}
              onclick={toggleService}>{paused ? 'Reprendre' : 'Pause'}</Button
            >
          </SettingsRow>
        </SettingsCard>
      {:else if theme === 'fiches'}
        <Types />
        <Lots {store} />
      {:else if theme === 'agent'}
        <Agent {store} />
      {:else if theme === 'fournisseurs'}
        <!-- The keys and their windows come with their page only. -->
        {#await import('../reglages/Modele.svelte')}
          <Skeleton height={160} />
        {:then m}
          <m.default {store} {spend} />
        {:catch e}
          <Banner title="Page indisponible">
            {e instanceof Error && e.message ? e.message : 'Recharger la page pour réessayer.'}
          </Banner>
        {/await}
      {:else}
        <Donnees />
      {/if}
    </div>
  </div>
</div>

<style>
  .reglages {
    display: grid;
    grid-template-columns: 236px minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }
  .themes {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 10px;
    border-right: 1px solid var(--bordure);
  }
  h1 {
    margin: 0 10px 4px;
    font: 500 24px/1.2 var(--serif);
  }
  .bloc {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .theme {
    position: relative;
  }
  .resume {
    display: none;
  }

  .contenu {
    min-height: 0;
    overflow-y: auto;
    /* Room under the last card for the agent's bubble. */
    padding: 24px 32px calc(40px + var(--agent-lanceur-h) + var(--agent-lanceur-bas));
  }
  .colonne {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-width: 780px;
    margin: 0 auto;
  }
  .colonne :global(.retour) {
    display: none;
  }
  .colonne :global(.entree.nombre) {
    width: 104px;
  }
  .tete small {
    font: 500 10.5px var(--sans);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--texte-3);
  }
  h2 {
    margin: 4px 0 6px;
    font: 500 32px/1.1 var(--serif);
    font-variant-numeric: lining-nums;
  }
  /* Focused by the page change, not by the user: no ring around a title. */
  h2:focus {
    outline: none;
  }
  .tete p {
    margin: 0;
    color: var(--texte-2);
  }

  @media (max-width: 767.98px) {
    .reglages {
      grid-template-columns: minmax(0, 1fr);
    }
    .themes {
      gap: 14px;
      padding: 16px 16px 24px;
      border-right: 0;
    }
    .ouvert .themes,
    .reglages:not(.ouvert) .contenu {
      display: none;
    }
    h1 {
      margin: 0 0 0 2px;
      font-size: 26px;
    }
    .themes :global(.groupe .titre) {
      min-height: 0;
      padding: 0 4px 6px;
    }
    .bloc {
      gap: 0;
      overflow: hidden;
      border: 1px solid var(--bordure);
      border-radius: var(--r-3);
      background: var(--surface-1);
    }
    .theme + .theme {
      border-top: 1px solid var(--bordure);
    }
    .themes :global(.lien) {
      gap: 12px;
      height: 50px;
      padding: 0 14px;
      border-radius: 0;
      color: var(--texte);
      font-size: 14px;
    }
    .themes :global(.lien.on) {
      background: none;
    }
    .themes :global(.lien.on::before) {
      display: none;
    }
    .themes :global(.lien .texte) {
      padding-right: 100px;
    }
    .resume {
      position: absolute;
      top: 50%;
      right: 14px;
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--texte-3);
      font-size: 12.5px;
      transform: translateY(-50%);
      pointer-events: none;
    }
    .contenu {
      padding: 8px 16px calc(24px + var(--agent-lanceur-h) + var(--agent-lanceur-bas));
    }
    .colonne {
      gap: 14px;
    }
    .colonne :global(.retour) {
      display: inline-flex;
      align-self: flex-start;
      margin-left: -6px;
    }
    h2 {
      font-size: 28px;
    }
  }
</style>
