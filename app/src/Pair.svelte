<script lang="ts">
  import { Banner, Button, CodeInput, icons, ICON_STROKE, StandaloneCard, Steps } from './lib/ui/index.ts';
  import { pair } from './session.ts';

  let {
    baseUrl,
    notice = null,
    authorizing = false,
    onPaired,
  }: {
    baseUrl: string;
    notice?: string | null;
    /** An app is waiting for an authorization: the page resumes it once this browser is paired. */
    authorizing?: boolean;
    onPaired: (token: string) => void;
  } = $props();

  const COMMAND = 'npm run pair-code';

  let code = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  const uid = $props.id();
  const errorId = `${uid}-erreur`;
  let copied = $state(false);
  let box = $state<HTMLElement | null>(null);

  // The field stays enabled while sending: disabling it would drop the focus.
  const field = () => box?.querySelector('input');

  async function send(value: string) {
    if (busy) return;
    busy = true;
    error = null;
    try {
      onPaired(await pair(baseUrl, value));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      // Everything selected: the next digit typed or code pasted replaces the refused one.
      field()?.focus();
      field()?.select();
    } finally {
      busy = false;
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (error) {
      // Only the refused code is cleared: digits already typed over it stay.
      if (code.length === 6) {
        code = '';
        error = null;
      }
      field()?.focus();
    } else if (code.length === 6) void send(code);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(COMMAND);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // The command stays readable on the page.
    }
  }
</script>

{#snippet waiting()}<Steps steps={['Relier le navigateur', 'Autoriser']} current={0} />{/snippet}

<div class="page lun-avaritia" data-monde="avaritia">
  <StandaloneCard
    title="Relier ce navigateur"
    lead={authorizing
      ? "Lun'Avaritia ne connaît pas ce navigateur. Saisir le code à 6 chiffres pour continuer."
      : 'Saisir le code à 6 chiffres. Il ne sert qu’une fois.'}
    steps={authorizing ? waiting : undefined}
  >
    {#if notice}<Banner tone="info" title={notice} class="avis" />{/if}
    <form onsubmit={submit}>
      <div bind:this={box} {@attach (el) => el.querySelector('input')?.focus()}>
        <CodeInput
          bind:value={code}
          error={error !== null}
          aria-describedby={error ? errorId : undefined}
          oncomplete={send}
        />
      </div>
      {#if error}
        <p class="erreur" id={errorId} role="alert">
          <icons.Ban size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />{error}
        </p>
      {:else}
        <p class="aide">Le code peut être collé tel quel.</p>
      {/if}
      <Button
        type="submit"
        variant="principal"
        size="grand"
        class="plein"
        loading={busy}
        disabled={!error && code.length < 6}
      >
        {error ? 'Réessayer' : 'Relier'}
      </Button>
    </form>
    <section class="sources" aria-labelledby="sources-titre">
      <h2 id="sources-titre">Où trouver le code</h2>
      <div class="source">
        <span class="ico" aria-hidden="true"><icons.Monitor size={16} strokeWidth={ICON_STROKE} /></span>
        <div class="texte">
          <span>Sur la machine qui héberge Lun'Avaritia</span>
          <code>{COMMAND}</code>
        </div>
        {#if navigator.clipboard}
          <Button
            variant="fantome"
            size="petit"
            icon={copied ? icons.Check : icons.Copy}
            aria-label={copied ? 'Commande copiée' : 'Copier la commande'}
            onclick={copy}>{copied ? 'Copiée' : 'Copier'}</Button
          >
        {/if}
      </div>
      <div class="source">
        <span class="ico" aria-hidden="true"><icons.Settings size={16} strokeWidth={ICON_STROKE} /></span>
        <div class="texte">
          <span>Sur un appareil déjà relié</span>
          <small>Réglages › Appareils et applications › Relier un appareil</small>
        </div>
      </div>
    </section>
  </StandaloneCard>
</div>

<style>
  .page {
    display: grid;
    min-height: 100dvh;
  }
  form {
    display: flex;
    flex-direction: column;
  }
  form :global(.plein) {
    width: 100%;
  }
  :global(.avis) {
    margin-bottom: 18px;
  }
  .aide,
  .erreur {
    margin: 8px 0 18px;
    font-size: 12.5px;
    text-align: center;
  }
  .aide {
    color: var(--texte-3);
  }
  .erreur {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 13px;
    color: var(--danger);
    text-wrap: balance;
  }
  .sources {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--bordure);
  }
  h2 {
    margin: 0;
    font: 500 10.5px var(--sans);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--texte-3);
  }
  .source {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: var(--r-2);
    background: var(--surface-2);
    border: 1px solid var(--bordure);
    font-size: 13px;
    color: var(--texte-2);
  }
  .ico {
    display: grid;
    place-items: center;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--surface-3);
  }
  .texte {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    min-width: 0;
  }
  code {
    padding: 2px 6px;
    border-radius: 5px;
    background: var(--fond);
    color: var(--texte);
    font:
      400 12.5px ui-monospace,
      Consolas,
      monospace;
  }
  small {
    font-size: 12.5px;
    color: var(--texte-3);
  }
</style>
