<script lang="ts">
  import type { Snippet } from 'svelte';
  import {
    bindShortcuts,
    BottomNav,
    Button,
    IconButton,
    icons,
    Kbd,
    NavLink,
    Rail,
    ICON_STROKE,
    ServiceCard,
    Toaster,
    type NavItem,
    type PaletteCommand,
  } from '../lib/ui/index.ts';
  import { agentIdentity, agentPanel, openAgent } from '../agent/conversation.svelte.ts';
  import { agentIcon } from '../agent/icons.ts';
  import { go } from '../memoire/titles.ts';
  import { formatCost } from '../format.ts';
  import { pathOf, type Route } from './routes.ts';

  /*
   * Shell of the standalone app, as Lun'Acedia's (plate 03): the rail with its counters and the
   * service card on a desktop, the top bar with the search (which opens the palette, Ctrl K) and the
   * pause, the agent's bubble in the bottom right corner, the toasts. Under 768 px: the bottom
   * navigation, and the agent's button in the top bar instead of the bubble.
   */

  type Props = {
    route: Route;
    counts: { valider: number; fiches: number };
    /** The service paused by hand or degraded, and the month's spend against its cap (unknown until read). */
    status: { paused: boolean; degraded: boolean; spend?: { spent: number; cap: number } | undefined };
    /** Pauses or resumes the processing. */
    ontogglepause: () => void;
    /** The agent's bubble, above the screens (it never resizes them). */
    agent?: Snippet | undefined;
    children: Snippet;
  };

  let { route, counts, status, ontogglepause, agent, children }: Props = $props();

  const items = $derived<(NavItem & { route: Route })[]>([
    { route: 'tableau', href: pathOf('tableau'), label: 'Tableau de bord', icon: icons.LayoutDashboard },
    {
      route: 'valider',
      href: pathOf('valider'),
      label: 'À valider',
      icon: icons.Sparkles,
      count: counts.valider,
      countTone: 'ia',
    },
    {
      route: 'memoire',
      href: pathOf('memoire'),
      label: 'Mémoire',
      icon: icons.FileText,
      count: counts.fiches,
    },
    { route: 'depots', href: pathOf('depots'), label: 'Dépôts', icon: icons.Folder },
    { route: 'reglages', href: pathOf('reglages'), label: 'Réglages', icon: icons.Settings },
  ]);

  const pauseLabel = $derived(status.paused ? 'Reprendre le traitement' : 'Mettre le traitement en pause');

  // The palette (bits-ui Command) comes with its first opening: it stays out of the first load.
  let palette = $state(false);
  let search = $state('');
  let paletteModule = $state<Promise<typeof import('../lib/ui/CommandPalette.svelte')> | null>(null);
  function togglePalette() {
    paletteModule ??= import('../lib/ui/CommandPalette.svelte');
    palette = !palette;
  }
  // From a field too, as Ctrl J: the palette is the way to everything.
  $effect(() => bindShortcuts({ 'Ctrl+k': togglePalette }, window, { fromFields: ['Ctrl+k'] }));

  const newNote = () => openAgent('Note que ');
  const AgentIcon = $derived(agentIcon(agentIdentity.icon));

  const commands = $derived.by((): PaletteCommand[] => {
    const q = search.trim();
    return [
      ...(q
        ? [
            {
              id: 'rechercher',
              label: `Rechercher « ${q} » dans la mémoire`,
              group: 'Recherche',
              icon: icons.Search,
              run: () => go(`${pathOf('memoire')}?${new URLSearchParams({ q })}`),
            },
          ]
        : []),
      { id: 'note', label: 'Nouvelle note', group: 'Action', icon: icons.Plus, run: newNote },
      {
        id: 'pause',
        label: pauseLabel,
        group: 'Action',
        icon: status.paused ? icons.Play : icons.Pause,
        run: ontogglepause,
      },
      ...items.map((item) => ({
        id: item.route,
        label: item.label,
        group: 'Aller à',
        icon: item.icon,
        run: () => go(item.href),
      })),
    ];
  });
</script>

{#snippet link(item: (typeof items)[number])}
  <NavLink
    href={item.href}
    label={item.label}
    icon={item.icon}
    count={item.count}
    countTone={item.countTone}
    current={route === item.route}
  />
{/snippet}

<div class="coque lun-avaritia" data-monde="avaritia">
  <Rail label="Sections" class="rail">
    {#snippet header()}
      <span class="marque"><i aria-hidden="true"></i>Lun'<em>Avaritia</em></span>
      <Button variant="principal" icon={icons.Plus} class="nouveau" onclick={newNote}>Nouvelle note</Button>
    {/snippet}
    {#each items.slice(0, 4) as item (item.route)}
      {@render link(item)}
    {/each}
    {#snippet footer()}
      {@render link(items[4]!)}
      <ServiceCard
        state={status.paused ? 'pause' : status.degraded ? 'cle-refusee' : 'actif'}
        detail={status.spend ? `${formatCost(status.spend.spent)} sur ${formatCost(status.spend.cap)}` : ''}
      />
    {/snippet}
  </Rail>

  <div class="zone">
    <header class="haut">
      <button type="button" class="rech" aria-haspopup="dialog" onclick={togglePalette}>
        <icons.Search size={16} strokeWidth={1.75} aria-hidden="true" />
        <span class="large">Rechercher dans la mémoire, ou une commande</span>
        <span class="court">Rechercher</span>
        <span class="touche"><Kbd>Ctrl K</Kbd></span>
      </button>
      <div class="droite">
        <span class="pause">
          <IconButton
            icon={status.paused ? icons.Play : icons.Pause}
            label={pauseLabel}
            onclick={ontogglepause}
          />
        </span>
        <button
          type="button"
          class="agent-haut"
          aria-label={agentIdentity.name}
          aria-expanded={agentPanel.open}
          onclick={() => (agentPanel.open = !agentPanel.open)}
        >
          <AgentIcon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </button>
      </div>
    </header>
    <main>{@render children()}</main>
  </div>

  <BottomNav {items} current={pathOf(route)} class="nav-mobile" />
  <div class="agent">{@render agent?.()}</div>
  {#if paletteModule}
    {#await paletteModule then m}
      <m.default
        {commands}
        bind:open={palette}
        bind:search
        shortcut={false}
        placeholder="Rechercher dans la mémoire, ou une commande"
      />
    {/await}
  {/if}
  <Toaster />
</div>

<style>
  .coque {
    display: flex;
    height: 100dvh;
    overflow: hidden;
  }
  .coque :global(.rail) {
    flex: none;
  }
  .marque {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 2px 8px 2px;
    font: 500 21px var(--serif);
    font-variant-numeric: lining-nums;
  }
  .marque i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-doux);
  }
  .marque em {
    color: var(--accent-texte);
  }
  .coque :global(.nouveau) {
    width: 100%;
    height: 38px;
  }
  .zone {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .haut {
    display: flex;
    flex: none;
    align-items: center;
    gap: 12px;
    height: 58px;
    padding: 0 18px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--bordure);
  }
  .rech {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    max-width: 620px;
    height: 38px;
    padding: 0 12px;
    background: var(--surface-1);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    color: var(--texte-3);
    font: 300 13.5px var(--sans);
    text-align: left;
    cursor: text;
  }
  .rech:hover {
    border-color: var(--accent-bord);
  }
  .rech:focus-visible {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }
  .touche {
    margin-left: auto;
  }
  .court {
    display: none;
  }
  .droite {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }
  main {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  /* No box of its own: the bubble (20) and the open panel (45) each stack on their own. */
  .agent {
    display: contents;
  }
  .agent-haut {
    display: none;
    place-items: center;
    flex: none;
    width: 42px;
    height: 42px;
    border: 1px solid var(--ia-bord);
    border-radius: 21px;
    background: var(--ia-doux);
    color: var(--ia);
    cursor: pointer;
  }
  .agent-haut:focus-visible {
    outline: 2px solid var(--ia);
    outline-offset: 2px;
  }
  .coque :global(.nav-mobile) {
    display: none;
  }

  @media (max-width: 767.98px) {
    .coque {
      flex-direction: column;
    }
    .coque :global(.rail) {
      display: none;
    }
    .haut {
      height: auto;
      padding: max(6px, env(safe-area-inset-top)) 14px 10px;
      border-bottom: 0;
    }
    .rech {
      max-width: none;
      height: 42px;
      border-radius: 21px;
    }
    .large,
    .touche,
    .pause {
      display: none;
    }
    .court {
      display: inline;
    }
    .coque :global(.nav-mobile) {
      display: grid;
      flex: none;
    }
    .agent-haut {
      display: grid;
    }
  }
</style>
