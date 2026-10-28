<script lang="ts">
  import type { Api } from './api.ts';
  import { returnHost, type AuthorizationRequest } from './authorization.ts';
  import { Button, icons, ICON_STROKE, StandaloneCard, Steps } from './lib/ui/index.ts';

  let {
    api,
    request,
    navigate = (url: string) => window.location.assign(url),
  }: {
    api: Api;
    request: AuthorizationRequest;
    /** Sends the browser back to the requesting app. */
    navigate?: (url: string) => void;
  } = $props();

  const RIGHTS = [
    { icon: icons.Eye, text: 'Lire l’état, les coûts et les événements' },
    { icon: icons.Check, text: 'Lire et trancher les cartes à valider' },
    { icon: icons.Sparkles, text: 'Interroger l’agent et lancer ses actions' },
    { icon: icons.Pause, text: 'Mettre en pause et reprendre le service' },
  ];

  /** The requesting app is only a name: its mark is its initial, in a neutral tone. */
  const initial = $derived(request.client.trim().charAt(0).toUpperCase() || '?');

  let busy = $state(false);
  let error = $state<string | null>(null);

  // Only an explicit click sends the decision; the buttons stay off until the browser leaves.
  async function decide(decision: 'allow' | 'deny') {
    busy = true;
    error = null;
    try {
      const { redirect } = await api.send<{ redirect: string }>('POST', '/api/authorizations', {
        ...request,
        decision,
      });
      navigate(redirect);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      busy = false;
    }
  }
</script>

{#snippet steps()}<Steps steps={['Navigateur relié', 'Autoriser']} current={1} />{/snippet}

<!-- The two marks, linked, above the title: who asks, and to whom. -->
{#snippet marks()}
  <div class="liens" aria-hidden="true">
    <span class="logo app">{initial}</span>
    <span class="fil"><i></i><i></i><i></i></span>
    <span class="logo avaritia">Av</span>
  </div>
{/snippet}

<div class="page lun-avaritia" data-monde="avaritia">
  <StandaloneCard
    title={`${request.client} demande l’accès à Lun'Avaritia`}
    {steps}
    top={marks}
    class="autoriser"
  >
    <p class="lead">Une fois reliée, cette application pourra :</p>
    <ul class="droits" aria-label="Droits demandés">
      {#each RIGHTS as right (right.text)}
        <li><right.icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />{right.text}</li>
      {/each}
    </ul>
    <p class="retour">
      <icons.Reply size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
      <span>Retour ensuite vers <b>{returnHost(request.redirect_uri)}</b></span>
    </p>
    {#if error}<p class="erreur" role="alert">{error}</p>{/if}
    <div class="boutons">
      <Button size="grand" disabled={busy} onclick={() => decide('deny')}>Refuser</Button>
      <Button variant="principal" size="grand" disabled={busy} onclick={() => decide('allow')}
        >Autoriser</Button
      >
    </div>
    {#snippet footer()}Accès retirable à tout moment dans Réglages › Appareils et applications.{/snippet}
  </StandaloneCard>
</div>

<style>
  .page {
    display: grid;
    min-height: 100dvh;
  }
  .page :global(.autoriser h1),
  .lead {
    text-align: center;
  }
  .liens {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin-bottom: 18px;
  }
  .logo {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 14px;
    border: 1px solid var(--bordure-forte);
    background: var(--surface-3);
    color: var(--texte-2);
    font: 500 22px var(--serif);
  }
  .logo.avaritia {
    border-color: var(--accent-bord);
    background: var(--accent-doux);
    color: var(--accent-texte);
  }
  .fil {
    display: flex;
    gap: 4px;
  }
  .fil i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--texte-3);
  }
  .lead {
    margin: 0 0 16px;
    font-size: 14px;
    color: var(--texte-2);
  }
  .droits {
    display: flex;
    flex-direction: column;
    margin: 0 0 16px;
    padding: 0;
    list-style: none;
  }
  .droits li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 4px;
    border-bottom: 1px solid var(--bordure);
    font-size: 13.5px;
    color: var(--texte);
  }
  .droits li:last-child {
    border-bottom: 0;
  }
  .droits :global(svg) {
    flex: none;
    color: var(--texte-3);
  }
  .retour {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 18px;
    font-size: 12.5px;
    color: var(--texte-3);
  }
  .retour b {
    font:
      400 12px ui-monospace,
      Consolas,
      monospace;
    color: var(--texte-2);
    overflow-wrap: anywhere;
  }
  .erreur {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--danger);
  }
  .boutons {
    display: flex;
    gap: 8px;
  }
  .boutons :global(.btn) {
    flex: 1 1 0;
  }
</style>
