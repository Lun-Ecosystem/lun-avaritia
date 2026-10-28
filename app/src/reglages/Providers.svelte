<script lang="ts">
  import { untrack } from 'svelte';
  import type { Api } from '../api.ts';
  import {
    Badge,
    Button,
    ConfirmDialog,
    Dialog,
    Field,
    icons,
    SettingsRow,
    TextInput,
    toast,
    type Tone,
  } from '../lib/ui/index.ts';
  import { expiryLine } from './expiry.ts';
  import type { ProviderId, ProviderView } from './types.ts';

  /*
   * One row per AI provider, inside the card of the language model (copied from Lun'Acedia): its
   * state, its key by its last 4 characters only. Adding or replacing opens a window (the check with
   * the provider can take seconds); removing asks first.
   */

  interface Props {
    api: Api;
    /** `null`: the keys could not be read. */
    providers: ProviderView[] | null;
    /** A key changed: the models offered change with it. */
    onchange?: (() => void) | undefined;
    /** Today, for tests. */
    now?: Date | undefined;
  }
  let { api, providers = $bindable(), onchange, now }: Props = $props();

  const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'L’action a échoué.');

  let editing = $state<ProviderId | null>(null);
  /** The provider whose declared expiry is being changed, and the date typed. */
  let dating = $state<ProviderView | null>(null);
  let date = $state('');
  let dateError = $state<string | undefined>();
  let datingBusy = $state(false);

  async function saveExpiry(expires: string | null) {
    if (!dating || datingBusy) return;
    datingBusy = true;
    dateError = undefined;
    try {
      put(await api.send<ProviderView>('PUT', `/api/llm/providers/${dating.id}/expires`, { expires }));
      toast(expires ? 'Échéance enregistrée' : 'Échéance retirée');
      dating = null;
    } catch (err) {
      dateError = errorText(err);
    } finally {
      datingBusy = false;
    }
  }

  const uid = $props.id();
  let key = $state('');
  let expires = $state('');
  let baseUrl = $state('');
  let pending = $state(false);
  let error = $state<string | undefined>();
  let removing = $state<ProviderView | null>(null);
  let retrying = $state(false);

  const BADGE: Record<ProviderView['state'], { text: string; tone: Tone }> = {
    ok: { text: 'En service', tone: 'ok' },
    refused: { text: 'Refusée', tone: 'danger' },
    credit: { text: 'Crédit épuisé', tone: 'attention' },
    absent: { text: 'Sans clé', tone: 'neutre' },
  };
  /** « auprès d’Anthropic », « auprès de Mistral »… */
  const WITH: Record<ProviderId, string> = {
    anthropic: 'd’Anthropic',
    openai: 'd’OpenAI',
    google: 'de Google',
    mistral: 'de Mistral',
    custom: 'du point d’accès',
  };

  const current = $derived(providers?.find((p) => p.id === editing));
  const ready = $derived(Boolean(key.trim()) && (editing !== 'custom' || Boolean(baseUrl.trim())));

  // On opening or closing the window only: a refresh of `providers` meanwhile keeps what is typed.
  $effect(() => {
    const open = editing;
    untrack(() => {
      if (!open) {
        key = '';
        expires = '';
        error = undefined;
      } else baseUrl = current?.baseUrl ?? '';
    });
  });

  const put = (view: ProviderView) => {
    providers = providers?.map((p) => (p.id === view.id ? view : p)) ?? null;
    onchange?.();
  };

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!editing || !ready || pending) return;
    pending = true;
    error = undefined;
    try {
      // On refusal nothing changes on the server: the window stays, with the reason.
      put(
        await api.send<ProviderView>('PUT', `/api/llm/providers/${editing}/key`, {
          key: key.trim(),
          ...(expires ? { expires } : {}),
          ...(editing === 'custom' ? { baseUrl: baseUrl.trim() } : {}),
        }),
      );
      editing = null;
      toast('Clé vérifiée et enregistrée');
    } catch (err) {
      error = errorText(err);
    } finally {
      pending = false;
    }
  }

  async function retry() {
    retrying = true;
    try {
      providers = (await api.get<{ providers: ProviderView[] }>('/api/llm/providers')).providers;
    } catch (err) {
      toast(errorText(err), { tone: 'danger' });
    } finally {
      retrying = false;
    }
  }

  /** The provider whose key was just removed: its « Retirer » is gone, the focus goes to its row. */
  let removed = $state<ProviderId | null>(null);

  async function remove() {
    const { id, label } = removing!;
    put(await api.send<ProviderView>('DELETE', `/api/llm/providers/${id}/key`));
    removed = id;
    toast(`Clé ${label} retirée`);
  }

  function focusAfterRemoval() {
    const id = removed;
    removed = null;
    return id ? document.querySelector<HTMLElement>(`.fournisseur-${id} button`) : null;
  }
</script>

{#if providers}
  {#each providers as p (p.id)}
    <SettingsRow label={p.label} class="fournisseur fournisseur-{p.id}">
      {#snippet hint()}
        {#if p.state === 'absent'}
          Aucune clé
        {:else}
          {p.source === 'env' ? 'Clé du fichier .env' : 'Clé enregistrée'}
          {#if p.last4}
            · se termine par <span class="mono">{p.last4}</span>
          {/if}
          {#if p.expires}
            {@const line = expiryLine(now ?? new Date(), p.expires)}
            <br /><span class={['echeance', line.tone]} data-ton={line.tone}>Échéance {line.text}</span>
          {/if}
        {/if}
      {/snippet}
      {#if p.state === 'absent'}
        <Button variant="principal" size="petit" icon={icons.Plus} onclick={() => (editing = p.id)}
          >Ajouter une clé</Button
        >
      {:else}
        <Badge tone={BADGE[p.state].tone} dot>{BADGE[p.state].text}</Badge>
        <Button size="petit" onclick={() => (editing = p.id)}>Remplacer…</Button>
        {#if p.source === 'saved'}
          <Button
            variant="fantome"
            size="petit"
            icon={icons.Calendar}
            onclick={() => {
              dating = p;
              date = p.expires ?? '';
            }}>Échéance</Button
          >
          <Button variant="fantome" size="petit" class="retirer" onclick={() => (removing = p)}
            >Retirer</Button
          >
        {/if}
      {/if}
    </SettingsRow>
  {/each}
{:else}
  <SettingsRow label="État des clés inconnu" hint="Les clés n’ont pas pu être lues.">
    <Button size="petit" loading={retrying} onclick={retry}>Réessayer</Button>
  </SettingsRow>
{/if}

<!-- A check in progress keeps the window open: its answer, a refusal included, must be seen. -->
<Dialog
  bind:open={
    () => Boolean(editing),
    (next) => {
      if (!pending && !next) editing = null;
    }
  }
  title={current && current.state !== 'absent' ? 'Remplacer la clé' : 'Ajouter une clé'}
  description={editing
    ? `${current?.label ?? ''} : vérifiée auprès ${WITH[editing]} avant d’être enregistrée, elle sert dès l’appel suivant.`
    : undefined}
>
  {#snippet children()}
    <form id="{uid}-cle" class="champs" onsubmit={save}>
      {#if editing === 'custom'}
        <Field label="Adresse" hint="Par exemple http://localhost:11434/v1 pour Ollama.">
          <TextInput
            type="url"
            autocomplete="off"
            spellcheck="false"
            autocapitalize="off"
            bind:value={baseUrl}
            disabled={pending}
          />
        </Field>
      {/if}
      <Field label="Nouvelle clé" {error}>
        <TextInput
          type="password"
          autocomplete="off"
          spellcheck="false"
          autocapitalize="off"
          bind:value={key}
          disabled={pending}
        />
      </Field>
      <Field label="Échéance" hint="Facultatif : aide-mémoire, avertissement 14 puis 3 jours avant.">
        <TextInput type="date" bind:value={expires} disabled={pending} />
      </Field>
      {#if pending && editing}<p class="attente" role="status">Vérification auprès {WITH[editing]}…</p>{/if}
    </form>
  {/snippet}
  {#snippet footer({ close })}
    <Button onclick={close} disabled={pending}>Annuler</Button>
    <Button type="submit" form="{uid}-cle" variant="principal" loading={pending} disabled={!ready}
      >Vérifier et enregistrer</Button
    >
  {/snippet}
</Dialog>

<!-- The date only: the key stays as it is; Bits gives the focus back to « Échéance ». -->
<Dialog
  bind:open={
    () => Boolean(dating),
    (next) => {
      if (!next && !datingBusy) {
        dating = null;
        dateError = undefined;
      }
    }
  }
  title="Modifier l’échéance"
  description={dating
    ? `Clé ${dating.label} : une date aide-mémoire, avertie 14 puis 3 jours avant. La clé ne change pas.`
    : undefined}
>
  {#snippet children()}
    <form
      id="{uid}-echeance"
      class="champs"
      onsubmit={(e) => {
        e.preventDefault();
        if (date) void saveExpiry(date);
      }}
    >
      <Field label="Échéance" error={dateError}>
        <TextInput type="date" bind:value={date} disabled={datingBusy} />
      </Field>
    </form>
  {/snippet}
  {#snippet footer({ close })}
    <Button variant="fantome" class="sans-date" disabled={datingBusy} onclick={() => saveExpiry(null)}
      >Sans échéance</Button
    >
    <Button onclick={close} disabled={datingBusy}>Annuler</Button>
    <Button type="submit" form="{uid}-echeance" variant="principal" loading={datingBusy} disabled={!date}
      >Enregistrer</Button
    >
  {/snippet}
</Dialog>

<ConfirmDialog
  bind:open={() => Boolean(removing), (next) => !next && (removing = null)}
  title="Retirer la clé {removing?.label ?? ''} ?"
  message="Le traitement des lots et l’agent s’arrêtent sans clé. Une nouvelle clé peut être ajoutée à tout moment."
  confirmLabel="Retirer la clé"
  onconfirm={remove}
  returnFocus={focusAfterRemoval}
/>

<style>
  .mono {
    font:
      400 13px ui-monospace,
      Consolas,
      monospace;
    color: var(--texte-2);
  }
  .echeance.attention {
    color: var(--attention);
  }
  .echeance.danger {
    color: var(--danger);
  }
  :global(.sans-date) {
    margin-right: auto;
  }
  :global(.fournisseur) :global(.btn.retirer) {
    color: var(--danger);
  }
  .champs {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .attente {
    margin: 0;
    font-size: 12.5px;
    color: var(--texte-2);
  }
</style>
