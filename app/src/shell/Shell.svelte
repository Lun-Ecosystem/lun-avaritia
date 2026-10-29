<script lang="ts">
  import type { Snippet } from 'svelte';
  import { BottomNav, icons, NavLink, Rail, ServiceCard, Toaster, type NavItem } from '../lib/ui/index.ts';
  import { formatCost } from '../format.ts';
  import { pathOf, type Route } from './routes.ts';

  /*
   * Shell of the standalone app: the rail with its counters and the service card on a desktop, the
   * bottom navigation under 760 px, the agent's bubble in the bottom right corner, the toasts.
   */

  type Props = {
    route: Route;
    counts: { valider: number; fiches: number };
    /** The service paused by hand or degraded, and the month's spend against its cap (unknown until read). */
    status: { paused: boolean; degraded: boolean; spend?: { spent: number; cap: number } | undefined };
    /** The agent's bubble, above the screens (it never resizes them). */
    agent?: Snippet | undefined;
    children: Snippet;
  };

  let { route, counts, status, agent, children }: Props = $props();

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

  <main>{@render children()}</main>

  <BottomNav {items} current={pathOf(route)} class="nav-mobile" />
  <div class="agent">{@render agent?.()}</div>
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
  main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }
  /* No box of its own: the bubble (20) and the open panel (45) each stack on their own. */
  .agent {
    display: contents;
    --agent-bas: var(--agent-lanceur-bas);
  }
  .coque :global(.nav-mobile) {
    display: none;
  }

  @media (max-width: 759.98px) {
    .coque {
      flex-direction: column;
    }
    .coque :global(.rail) {
      display: none;
    }
    .coque :global(.nav-mobile) {
      display: grid;
      flex: none;
    }
    /* Above the bottom navigation. */
    .agent {
      --agent-bas: calc(68px + env(safe-area-inset-bottom, 0px) + 14px);
    }
  }
</style>
