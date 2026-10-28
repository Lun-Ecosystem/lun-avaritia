<script lang="ts">
  import { createNodeBorderProgram } from '@sigma/node-border';
  import { inferSettings } from 'graphology-layout-forceatlas2';
  import FA2Layout from 'graphology-layout-forceatlas2/worker';
  import Sigma from 'sigma';
  import type { NodeHoverDrawingFunction } from 'sigma/rendering';
  import { getContext, untrack } from 'svelte';
  import type { Api } from '../api.ts';
  import { Banner, Chip, EmptyState, icons, Skeleton } from '../lib/ui/index.ts';
  import { bindShortcuts } from '../lib/ui/shortcuts.ts';
  import FichePanel from './FichePanel.svelte';
  import { activeSet, buildGraph, type GraphData, type Palette } from './graph.ts';

  /*
   * The fiche graph (ADR 0006): Sigma draws, ForceAtlas2 lays out in a worker. Loaded on demand by the
   * memory, only in the graph mode. Colors come from the tokens of the page, never written here.
   */

  type Props = {
    selected: number | null;
    /** Text of the « Centrer le graphe sur… » field. */
    centre: string;
    onOpen: (id: number | null) => void;
  };
  let { selected, centre, onOpen }: Props = $props();

  type Type = { id: number; name: string };

  const api = getContext<Api>('api');
  let data = $state<GraphData | null>(null);
  let types = $state<Type[]>([]);
  let failure = $state<string | null>(null);
  let shown = $state<number[]>([]);
  let centred = $state<number | null>(null);
  let missing = $state(false);
  let container = $state<HTMLDivElement>();
  let wrapper = $state<HTMLDivElement>();
  let sigma = $state.raw<Sigma | null>(null);
  let graph = $state.raw<ReturnType<typeof buildGraph> | null>(null);

  api
    .get<GraphData>('/api/graph')
    .then((d) => (data = d))
    .catch((e: Error) => (failure = e.message));
  api
    .get<{ types: Type[] }>('/api/types')
    .then((r) => (types = r.types))
    .catch(() => (types = []));

  const counts = $derived(
    (data?.nodes ?? []).reduce(
      (m, n) => m.set(n.typeId, (m.get(n.typeId) ?? 0) + 1),
      new Map<number, number>(),
    ),
  );
  // The focused fiche: the one searched for, else the one open in the panel.
  const focused = $derived(centred ?? selected);

  function toggle(id: number) {
    shown = shown.includes(id) ? shown.filter((t) => t !== id) : [...shown, id];
  }

  // Sigma, the palette and the layout: built once the container and the data are there.
  $effect(() => {
    if (!container || !data || data.nodes.length === 0) return;
    const css = getComputedStyle(container);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const palette: Palette = {
      node: token('--lavis'),
      edge: token('--bordure-forte'),
      flagged: token('--danger'),
      accent: token('--accent'),
      label: token('--lune'),
    };
    const fill = token('--surface-2');
    const strong = token('--ivoire');
    const font = token('--sans');
    const g = untrack(() => buildGraph(data!, palette));

    // The hover label on a dark tag, not Sigma's default white box.
    const drawHover: NodeHoverDrawingFunction = (ctx, d, settings) => {
      if (!d.label) return;
      ctx.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
      const w = ctx.measureText(d.label).width;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(d.x + d.size + 2, d.y - 11, w + 12, 22, 6);
      ctx.fill();
      ctx.fillStyle = strong;
      ctx.fillText(d.label, d.x + d.size + 8, d.y + settings.labelSize / 3);
    };

    const s = new Sigma(g, container, {
      defaultNodeType: 'bord',
      nodeProgramClasses: {
        bord: createNodeBorderProgram({
          borders: [
            { size: { value: 0.18 }, color: { attribute: 'borderColor' } },
            { size: { fill: true }, color: { attribute: 'fillColor', defaultValue: fill } },
          ],
          drawLabel: undefined,
          drawHover,
        }),
      },
      labelColor: { attribute: 'labelColor', color: palette.label },
      labelFont: font,
      labelSize: 12,
      // Labels only once zoomed in enough: thousands of titles at once would be unreadable.
      labelRenderedSizeThreshold: 9,
      hideEdgesOnMove: g.size > 5000,
      zIndex: true,
      minCameraRatio: 0.05,
      maxCameraRatio: 4,
    });
    s.on('clickNode', ({ node }) => {
      centred = null;
      onOpen(Number(node));
    });
    s.on('clickStage', () => (centred = null));

    const layout = new FA2Layout(g, {
      settings: { ...inferSettings(g), barnesHutOptimize: g.order > 500 },
    });
    layout.start();
    // Stops once the nodes barely move, or after 3 s at most.
    let last = new Map<string, [number, number]>();
    const watch = setInterval(() => {
      let moved = 0;
      let span = 0;
      g.forEachNode((key, a) => {
        const p = last.get(key);
        if (p) moved += Math.abs(a.x - p[0]) + Math.abs(a.y - p[1]);
        span = Math.max(span, Math.abs(a.x), Math.abs(a.y));
      });
      const still = last.size > 0 && moved / g.order < span * 0.0005;
      last = new Map(g.mapNodes((key, a) => [key, [a.x, a.y]] as [string, [number, number]]));
      if (still) settle();
    }, 300);
    const timer = setTimeout(settle, 3000);
    function stop() {
      layout.stop();
      clearInterval(watch);
      clearTimeout(timer);
    }
    // The nodes moved while the layout ran: the camera goes back to the focused fiche.
    function settle() {
      stop();
      const id = untrack(() => focused);
      if (id !== null) fly(id);
    }

    graph = g;
    sigma = s;
    return () => {
      stop();
      layout.kill();
      s.kill();
      sigma = null;
      graph = null;
    };
  });

  // Focus and type filter: the fiche and its neighbours stand out, the others fade.
  $effect(() => {
    const s = sigma;
    const g = graph;
    if (!s || !g) return;
    const near = activeSet(g, focused);
    const keep = shown.length ? new Set(shown) : null;
    const css = getComputedStyle(container!);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const [accent, ring, strong, faint, lavis] = [
      '--accent',
      '--accent-survol',
      '--ivoire',
      '--bordure',
      '--lavis',
    ].map(token);
    s.setSetting('nodeReducer', (key, a) => {
      const id = Number(key);
      if (keep && !keep.has(a.typeId)) return { ...a, hidden: true };
      if (!near) return a;
      if (id === focused)
        return {
          ...a,
          fillColor: accent,
          borderColor: ring,
          labelColor: strong,
          forceLabel: true,
          zIndex: 2,
        };
      if (near.has(id)) return { ...a, forceLabel: true, zIndex: 1 };
      return { ...a, borderColor: faint, label: '', zIndex: 0 };
    });
    s.setSetting('edgeReducer', (key, a) => {
      // An edge to a hidden node is hidden by Sigma itself.
      if (!near) return a;
      const [from, to] = g.extremities(key).map(Number);
      return from === focused || to === focused ? { ...a, color: lavis, size: 1.5 } : { ...a, hidden: true };
    });
  });

  // « Centrer sur… »: 250 ms after the last key, the camera flies to the best title.
  $effect(() => {
    const q = centre.trim().toLowerCase();
    const nodes = data?.nodes;
    if (!q || !nodes) {
      centred = null;
      missing = false;
      return;
    }
    const timer = setTimeout(() => {
      const hit =
        nodes.find((n) => n.title.toLowerCase().startsWith(q)) ??
        nodes.find((n) => n.title.toLowerCase().includes(q));
      missing = !hit;
      centred = hit?.id ?? null;
      if (hit) fly(hit.id);
    }, 250);
    return () => clearTimeout(timer);
  });

  // An open fiche (address, click) is brought into view too.
  $effect(() => {
    if (selected !== null && sigma) untrack(() => fly(selected));
  });

  // Escape closes the panel (from the panel or the graph, not from a field) and gives the graph the focus.
  $effect(() => {
    if (!wrapper || selected === null) return;
    return bindShortcuts(
      {
        Escape: () => {
          onOpen(null);
          container?.focus();
        },
      },
      wrapper,
    );
  });

  function fly(id: number) {
    const d = sigma?.getNodeDisplayData(String(id));
    const camera = sigma?.getCamera();
    // Closer only: a reader already zoomed in further keeps their zoom.
    if (d && camera)
      void camera.animate({ x: d.x, y: d.y, ratio: Math.min(camera.ratio, 0.25) }, { duration: 600 });
  }
</script>

{#if failure}
  <Banner title="Graphe indisponible">{failure}</Banner>
{:else if !data}
  <Skeleton height={420} />
{:else if data.nodes.length === 0}
  <EmptyState size="grand" tone="neutre" icon={icons.FileText} title="Aucune fiche." />
{:else}
  <div class="graphe" bind:this={wrapper}>
    {#if types.length}
      <div class="filtres" role="group" aria-label="Filtrer par type">
        {#each types.filter((t) => counts.has(t.id)) as t (t.id)}
          <Chip on={shown.includes(t.id)} count={counts.get(t.id)} onclick={() => toggle(t.id)}>{t.name}</Chip
          >
        {/each}
      </div>
    {/if}
    {#if missing}<p class="manque" role="status">Aucune fiche ne correspond.</p>{/if}
    <div class="scene" bind:this={container} aria-label="Graphe des fiches" role="img" tabindex="-1"></div>
    <p class="aide">Clic sur un nœud : la fiche s’ouvre à côté. Contour rouge : fiche à vérifier.</p>
    {#if selected !== null}
      <aside class="panneau" aria-label="Fiche">
        {#key selected}
          <FichePanel id={selected} onOpen={(id) => onOpen(id)} onClose={() => onOpen(null)} />
        {/key}
      </aside>
    {/if}
  </div>
{/if}

<style>
  .graphe {
    position: relative;
    display: grid;
    gap: 10px;
  }
  .filtres {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .scene {
    height: calc(100dvh - 220px);
    min-height: 360px;
    border: 1px solid var(--bordure);
    border-radius: var(--r-2);
    background: var(--fond);
    overflow: hidden;
  }
  .aide,
  .manque {
    margin: 0;
    color: var(--texte-3);
    font-size: 12px;
  }
  .panneau {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(420px, 45%);
    padding: 16px;
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    background: var(--surface-1);
    box-shadow: var(--ombre-2);
    overflow-y: auto;
  }
  @media (max-width: 759.98px) {
    .panneau {
      position: fixed;
      inset: 0;
      /* Over the agent bubble (20), under the open agent panel (45). */
      z-index: 30;
      width: auto;
      border: 0;
      border-radius: 0;
    }
  }
</style>
