<script lang="ts">
  import { Banner, Button, CodeInput, icons, ICON_STROKE, StandaloneCard, Steps } from './lib/ui/index.ts';
  import { firstCode, pair, REFUSED_CODE } from './session.ts';

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

  /** The first device's code, shown only on the hosting machine while nothing is paired. */
  let first = $state<{ code: string; expiresAt: string } | null>(null);
  /** The field still holds the first code: the page says so, and when it expires. */
  const holding = $derived(first !== null && code === first.code);
  const expiresId = `${uid}-expire`;
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // Once at display, then once per « Nouveau code »: never on a timer.
  async function ask() {
    first = await firstCode(baseUrl);
    // The answer may come while digits are being typed: they stay.
    if (first && !code) code = first.code;
  }
  void ask();

  async function renew() {
    code = '';
    error = null;
    await ask();
    field()?.focus();
  }

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
    lead={holding
      ? "Aucun appareil n'est encore appairé à Lun'Avaritia. Le code du premier appareil est déjà saisi : seule cette page, ouverte sur la machine qui l'héberge, l'affiche."
      : authorizing
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
          aria-describedby={error ? errorId : holding ? expiresId : undefined}
          oncomplete={send}
        />
      </div>
      {#if error}
        <p class="erreur" id={errorId} role="alert">
          <icons.Ban size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />{error}
        </p>
      {:else if holding && first}
        <p class="aide" id={expiresId}>Code du premier appareil. Il expire à {time(first.expiresAt)}.</p>
      {:else}
        <p class="aide">Le code peut être collé tel quel.</p>
      {/if}
      <!-- While an app waits for its authorization here, no sentence sends elsewhere. -->
      {#if first && !authorizing}
        <!-- Pasted in an app's linking form, this code would leave the browser without one. -->
        <Banner tone="info" title="Ce code est pour ce navigateur." class="avis">
          Pour relier une application : entrer, puis Réglages › Appareils et applications › Relier un
          appareil.
        </Banner>
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
      <!-- Offered as long as the field lost the first code: refused, cleared, or typed over. -->
      {#if first && (error === REFUSED_CODE || !holding)}
        <Button variant="secondaire" size="grand" class="plein nouveau" onclick={renew}>Nouveau code</Button>
      {/if}
    </form>
    {#if !first}
      <section class="sources" aria-labelledby="sources-titre">
        <h2 id="sources-titre">Où trouver le code</h2>
        <div class="source">
          <span class="ico" aria-hidden="true"><icons.Settings size={16} strokeWidth={ICON_STROKE} /></span>
          <div class="texte">
            <span>Sur un appareil déjà relié</span>
            <small>Réglages › Appareils et applications › Relier un appareil</small>
          </div>
        </div>
        <div class="source">
          <span class="ico" aria-hidden="true"><icons.AppWindow size={16} strokeWidth={ICON_STROKE} /></span>
          <div class="texte">
            <span>Sur une installation neuve</span>
            <small
              >Cette page, ouverte sur la machine qui héberge Lun'Avaritia, affiche le code du premier
              appareil.</small
            >
          </div>
        </div>
        <div class="source">
          <span class="ico" aria-hidden="true"><icons.Monitor size={16} strokeWidth={ICON_STROKE} /></span>
          <div class="texte">
            <span>Recours, dans un terminal de cette machine</span>
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
      </section>
    {/if}
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
  form :global(.nouveau) {
    margin-top: 8px;
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
