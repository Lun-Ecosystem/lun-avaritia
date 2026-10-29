<script lang="ts">
  import { getContext } from 'svelte';
  import type { Api } from '../api.ts';
  import {
    Badge,
    Banner,
    Button,
    ConfirmDialog,
    ICON_STROKE,
    icons,
    SettingsCard,
    Skeleton,
    toast,
  } from '../lib/ui/index.ts';
  import Dialog from '../lib/ui/Dialog.svelte';

  /*
   * What holds an access to Lun'Avaritia (copied from Lun'Acedia): each device and app, since when
   * (the server keeps no last activity), this browser marked. Removing one asks first and says what
   * follows; removing this browser sends it back to pairing.
   */

  type LinkedClient = {
    id: number;
    name: string;
    kind: 'device' | 'app';
    createdAt: string;
    current: boolean;
  };

  const api = getContext<Api>('api');
  let clients = $state<LinkedClient[] | null>(null);
  let failure = $state<string | null>(null);
  const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'L’action a échoué.');

  api
    .get<{ clients: LinkedClient[] }>('/api/clients')
    .then((r) => (clients = r.clients))
    .catch((e: unknown) => (failure = errorText(e)));

  let removing = $state<LinkedClient | null>(null);
  let code = $state<{ code: string; expiresAt: string; issuedAt: number } | null>(null);
  // Apart from the code: the last code stays shown while the window fades out.
  let showing = $state(false);
  let now = $state(Date.now());
  let linking = $state(false);
  let error = $state<string | null>(null);

  async function revoke() {
    const c = removing!;
    await api.send('DELETE', `/api/clients/${c.id}`);
    // The token is dead: one call with it lets the app's 401 handling go back to pairing.
    if (c.current) {
      void api.get('/api/clients').catch(() => {});
      return;
    }
    const list = clients ?? [];
    removedAt = list.findIndex((x) => x.id === c.id);
    clients = list.filter((x) => x.id !== c.id);
    toast(`Accès retiré : ${c.name}`);
  }

  let card = $state<HTMLElement | null>(null);
  /** Index of the access just removed: the focus goes to the row now in its place. */
  let removedAt = $state<number | null>(null);

  function focusAfterRemoval() {
    if (removedAt === null) return null;
    const buttons = card?.querySelectorAll<HTMLElement>('li button') ?? [];
    const next = buttons[Math.min(removedAt, buttons.length - 1)];
    removedAt = null;
    return next ?? card?.querySelector<HTMLElement>('header button');
  }

  /** The server only knows « device » or « app »: a phone is told by the name its browser gave. */
  const PHONE = /iphone|ipad|android|mobile|téléphone|smartphone/i;
  const iconOf = (c: LinkedClient) =>
    c.kind === 'app' ? icons.AppWindow : PHONE.test(c.name) ? icons.Smartphone : icons.Monitor;

  async function link() {
    error = null;
    linking = true;
    try {
      code = {
        ...(await api.send<{ code: string; expiresAt: string }>('POST', '/api/pairing-codes')),
        issuedAt: Date.now(),
      };
      now = Date.now();
      showing = true;
    } catch (err) {
      error = errorText(err);
    } finally {
      linking = false;
    }
  }

  // shortcut: the server's expiresAt is compared with the browser's clock, so a browser clock off by
  // minutes shows the wrong time left; send the server's time with the code if that ever matters.
  const left = $derived(code ? Math.max(0, new Date(code.expiresAt).getTime() - now) : 0);
  const expired = $derived(code !== null && left === 0);
  // The bar starts full when the code is shown: the server's clock is not the browser's.
  const share = $derived(code ? left / Math.max(1, new Date(code.expiresAt).getTime() - code.issuedAt) : 0);

  // Ticks only while the window shows a live code.
  $effect(() => {
    if (!showing || !code || expired) return;
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  async function copyCode(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast('Code copié');
    } catch {
      toast('Copie impossible : recopier le code à la main', { tone: 'danger' });
    }
  }

  const thisYear = new Date().getFullYear();
  /** « 18 oct. », with the year when it is not this one. */
  const date = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      ...(d.getFullYear() === thisYear ? {} : { year: 'numeric' }),
    });
  };
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const since = (c: LinkedClient) =>
    c.kind === 'app' ? `Application · reliée le ${date(c.createdAt)}` : `Relié le ${date(c.createdAt)}`;

  const confirmation = $derived.by(() => {
    if (!removing) return { title: '', message: '', label: '' };
    if (removing.current)
      return {
        title: 'Retirer ce navigateur ?',
        message:
          "Ce navigateur perdra l’accès à Lun'Avaritia. Un nouveau code sera nécessaire pour le relier.",
        label: 'Retirer ce navigateur',
      };
    if (removing.kind === 'app')
      return {
        title: `Retirer ${removing.name} ?`,
        message:
          "Cette application perdra l’accès à Lun'Avaritia. Elle devra demander une nouvelle autorisation.",
        label: 'Retirer l’application',
      };
    return {
      title: `Retirer ${removing.name} ?`,
      message: "Cet appareil perdra l’accès à Lun'Avaritia. Un nouveau code sera nécessaire pour le relier.",
      label: 'Retirer l’appareil',
    };
  });
</script>

<div bind:this={card}>
  <SettingsCard
    title="Appareils"
    description={clients ? `${clients.length} accès` : 'Les navigateurs et applications reliés.'}
  >
    {#snippet aside()}
      <Button size="petit" icon={icons.Plus} loading={linking} onclick={link}>Relier un appareil</Button>
    {/snippet}
    {#if error}<p class="erreur" role="alert">{error}</p>{/if}
    {#if failure}
      <div class="bloc"><Banner title="Accès illisibles">{failure}</Banner></div>
    {:else if !clients}
      <div class="bloc"><Skeleton height={40} /></div>
    {/if}
    <ul>
      {#each clients ?? [] as c (c.id)}
        {@const Icon = iconOf(c)}
        <li>
          <span class="ico" aria-hidden="true"><Icon size={16} strokeWidth={ICON_STROKE} /></span>
          <div class="texte">
            <div class="nom">
              <b>{c.name}</b>
              {#if c.current}<Badge tone="ok">Ce navigateur</Badge>{/if}
            </div>
            <small>{since(c)}</small>
          </div>
          <Button variant="fantome" size="petit" onclick={() => (removing = c)}>Retirer</Button>
        </li>
      {/each}
    </ul>
  </SettingsCard>
</div>

<Dialog
  bind:open={showing}
  title="Code pour un nouvel appareil"
  description={!expired && code
    ? `Saisir ce code sur l’appareil à relier. Il expire à ${time(code.expiresAt)}.`
    : 'Ce code a expiré. En demander un nouveau.'}
  width={400}
>
  {#if code}
    <p class={['chiffres', { expire: expired }]}>
      <span>{code.code.slice(0, 3)}</span><span class="point" aria-hidden="true">·</span><span
        >{code.code.slice(3)}</span
      >
    </p>
    <div class="minuteur" aria-hidden="true"><span style:width="{share * 100}%"></span></div>
    <div class="infos">
      <span>{expired ? 'Expiré' : `${Math.ceil(left / 60_000)} min restante${left > 60_000 ? 's' : ''}`}</span
      >
      <span>Usage unique</span>
    </div>
  {/if}
  {#snippet footer({ close })}
    <Button onclick={close}>Fermer</Button>
    {#if expired}
      <Button variant="doux" loading={linking} onclick={link}>Nouveau code</Button>
    {:else}
      <Button variant="doux" icon={icons.Copy} onclick={() => code && copyCode(code.code)}>Copier</Button>
    {/if}
  {/snippet}
</Dialog>

<ConfirmDialog
  bind:open={() => removing !== null, (open) => !open && (removing = null)}
  title={confirmation.title}
  message={confirmation.message}
  confirmLabel={confirmation.label}
  onconfirm={revoke}
  returnFocus={focusAfterRemoval}
/>

<style>
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    border-bottom: 1px solid var(--bordure);
  }
  li:last-child {
    border-bottom: 0;
  }
  .ico {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: var(--r-2);
    background: var(--surface-3);
    color: var(--texte-2);
  }
  .texte {
    flex: 1;
    min-width: 0;
  }
  .nom {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
  }
  b {
    font-weight: 500;
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    font-size: 12.5px;
    color: var(--texte-3);
  }
  .chiffres {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin: 6px 0 10px;
    font: 400 34px/1.2 var(--sans);
    letter-spacing: 0.06em;
    font-variant-numeric: tabular-nums;
    color: var(--texte);
  }
  .chiffres.expire {
    color: var(--texte-3);
    text-decoration: line-through;
  }
  .point {
    color: var(--texte-3);
  }
  .minuteur {
    height: 4px;
    margin: 4px 0 6px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--surface-3);
  }
  .minuteur span {
    display: block;
    height: 100%;
    background: var(--accent-texte);
    transition: width 1s linear;
  }
  .infos {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
    font-size: 12px;
    color: var(--texte-3);
  }
  @media (prefers-reduced-motion: reduce) {
    .minuteur span {
      transition: none;
    }
  }
  .bloc {
    padding: 14px 18px;
  }
  .erreur {
    margin: 0;
    padding: 10px 18px;
    font-size: 12.5px;
    color: var(--danger);
  }
  @media (max-width: 767.98px) {
    li {
      padding: 12px 14px;
    }
  }
</style>
