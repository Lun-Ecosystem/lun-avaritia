<script lang="ts">
  import { setContext } from 'svelte';
  import { createApi, type Api } from './api.ts';
  import { readAuthorization } from './authorization.ts';
  import Authorize from './Authorize.svelte';
  import { Banner, Button, Skeleton, StandaloneCard } from './lib/ui/index.ts';
  import Pair from './Pair.svelte';
  import { clearToken, loadToken, saveToken } from './session.ts';
  import { pathOf, ROUTES, routeFromPath, type Route } from './shell/routes.ts';
  import Shell from './shell/Shell.svelte';
  import AgentPanel from './agent/AgentPanel.svelte';
  import Memoire from './screens/Memoire.svelte';
  import Tableau from './screens/Tableau.svelte';
  import Valider from './screens/Valider.svelte';

  // The app is served by Lun'Avaritia itself (or proxied to it in development).
  const baseUrl = window.location.origin;

  let token = $state(loadToken(localStorage));
  let notice = $state<string | null>(null);

  let route = $state(routeFromPath(window.location.pathname));
  // `?filtre=` of the queue: a link to the same screen changes it without a new screen.
  let filtre = $state(new URLSearchParams(window.location.search).get('filtre'));
  let fiche = $state(new URLSearchParams(window.location.search).get('fiche'));
  let mode = $state(new URLSearchParams(window.location.search).get('mode'));
  let theme = $state(new URLSearchParams(window.location.search).get('theme'));
  function follow() {
    route = routeFromPath(window.location.pathname);
    const q = new URLSearchParams(window.location.search);
    filtre = q.get('filtre');
    fiche = q.get('fiche');
    mode = q.get('mode');
    theme = q.get('theme');
  }

  // An app asks for access (`GET /lun/v1/authorize`): the request waits here, through pairing if needed.
  let authorization = $state(readAuthorization(window.location.search));

  /** Leaves the authorization page for the app itself, without the request in the address. */
  function leaveAuthorization() {
    authorization = null;
    history.replaceState(null, '', window.location.pathname);
  }

  // Only for the token still in use: a late 401 of an older one resets neither pairing nor a new token.
  function forget(t: string) {
    if (token !== t) return;
    clearToken(localStorage);
    token = null;
    notice = 'Cet appareil n’est plus reconnu. Saisir un nouveau code pour le relier.';
  }

  const api = $derived.by(() => {
    const t = token;
    return t ? createApi(baseUrl, t, { onUnauthorized: () => forget(t) }) : null;
  });
  // Each screen reads the client with `getContext('api')`; a getter follows a new pairing.
  setContext('api', {
    get: <T,>(path: string) => api!.get<T>(path),
    send: <T,>(method: string, path: string, body?: unknown) => api!.send<T>(method, path, body),
    upload: <T,>(path: string, form: FormData) => api!.upload<T>(path, form),
  } satisfies Api);

  let status = $state<{ paused: boolean; degraded: boolean; spend?: { spent: number; cap: number } }>({
    paused: false,
    degraded: false,
  });
  let counts = $state({ valider: 0, fiches: 0 });

  /** Reads the service state again (at pairing, after a pause or a resume in the settings). */
  async function readHealth() {
    const a = api;
    if (!a) return;
    await a
      .get<{ status: string; paused?: boolean }>('/lun/v1/health')
      .then((h) => {
        status.paused = h.status === 'paused' || h.paused === true;
        status.degraded = h.status === 'degraded';
      })
      .catch(() => {});
  }
  $effect(() => {
    void readHealth();
  });

  // Rail counters, read again at each change of screen.
  $effect(() => {
    const a = api;
    void route;
    if (!a) return;
    a.get<{ pending: { drafts: number }; fiches: number; monthSpend: number; monthlyCap: number }>(
      '/api/dashboard',
    )
      .then((d) => {
        counts.valider = d.pending.drafts;
        counts.fiches = d.fiches;
        status.spend = { spent: d.monthSpend, cap: d.monthlyCap };
      })
      .catch(() => {});
  });

  // Links inside the app change the screen without reloading the page; the back button follows.
  function navigate(event: MouseEvent) {
    if (
      !api ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey
    )
      return;
    const link = (event.target as Element | null)?.closest?.('a');
    const href = link?.getAttribute('href');
    // Only the screens of the app: /api/, /lun/ and downloads stay with the browser.
    const path = href?.split(/[?#]/)[0];
    if (!link || !href || link.target || link.hasAttribute('download')) return;
    if (!ROUTES.some((r) => pathOf(r) === path)) return;
    event.preventDefault();
    if (href !== window.location.pathname + window.location.search) history.pushState(null, '', href);
    follow();
  }

  function paired(t: string) {
    saveToken(localStorage, t);
    notice = null;
    token = t;
  }
</script>

<svelte:window onclick={navigate} onpopstate={follow} />

<!-- The deposits and the settings come with their screen: they stay out of the first load. -->
{#snippet loading()}
  <div class="chargement"><Skeleton height={160} /></div>
{/snippet}
{#snippet failed(e: unknown)}
  <div class="chargement">
    <Banner title="Écran indisponible">
      {e instanceof Error && e.message ? e.message : 'Recharger la page pour réessayer.'}
    </Banner>
  </div>
{/snippet}

{#if authorization && 'error' in authorization}
  <div class="refused lun-avaritia" data-monde="avaritia">
    <StandaloneCard title="Demande d’accès refusée">
      <p class="error" role="alert">{authorization.error}</p>
      <Button variant="principal" size="grand" onclick={leaveAuthorization}>Ouvrir Lun'Avaritia</Button>
    </StandaloneCard>
  </div>
{:else if api && authorization}
  <Authorize {api} request={authorization.request} />
{:else if api}
  <Shell {route} {counts} {status}>
    {#snippet agent()}
      <AgentPanel fiche={route === 'memoire' ? fiche : null} />
    {/snippet}
    {#key route}
      {#if route === 'tableau'}
        <Tableau />
      {:else if route === 'valider'}
        <Valider {filtre} />
      {:else if route === 'memoire'}
        <Memoire {fiche} {mode} />
      {:else if route === 'depots'}
        {#await import('./screens/Depots.svelte')}
          {@render loading()}
        {:then m}
          <m.default />
        {:catch e}
          {@render failed(e)}
        {/await}
      {:else}
        {#await import('./screens/Reglages.svelte')}
          {@render loading()}
        {:then m}
          <m.default paused={status.paused} onservice={readHealth} {theme} />
        {:catch e}
          {@render failed(e)}
        {/await}
      {/if}
    {/key}
  </Shell>
{:else}
  <Pair {baseUrl} {notice} authorizing={authorization !== null} onPaired={paired} />
{/if}

<style>
  :global(html, body) {
    margin: 0;
    background: var(--fond);
    color-scheme: dark;
  }
  .chargement {
    max-width: 900px;
    margin: 0 auto;
    padding: 24px;
  }
  .refused {
    display: grid;
    min-height: 100dvh;
  }
  .refused .error {
    margin: 0 0 18px;
    color: var(--danger);
    line-height: 1.5;
  }
</style>
