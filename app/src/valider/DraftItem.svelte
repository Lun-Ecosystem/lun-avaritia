<script lang="ts">
  import { openFiche, titleKey } from '../memoire/titles.ts';
  import Prose from '../Prose.svelte';
  import { Badge, Button, icons, Kbd, SettingsCard } from '../lib/ui/index.ts';
  import { kindOf, swapped, type DraftPayload, type DraftView } from './drafts.ts';
  import FicheDraftEditor from './FicheDraftEditor.svelte';

  /*
   * One draft of the queue, one card: what it would write, then one primary action (« Valider ») and
   * its alternatives (« Refuser », « Modifier » for a fiche, « Garder l’autre » for a choice).
   */

  type Props = {
    draft: DraftView;
    /** Target of V and R. */
    active: boolean;
    editing: boolean;
    busy: boolean;
    /** Answer of the server to the last decision (400), shown on the card. */
    error?: string | undefined;
    onaccept: (input?: DraftPayload) => void;
    onrefuse: () => void;
    onedit: (on: boolean) => void;
    onactivate: () => void;
    /** Id by title of the memory, read once by the queue: a known [[Fiche]] opens that fiche. */
    ids: Map<string, number>;
  };

  let { draft, active, editing, busy, error, onaccept, onrefuse, onedit, onactivate, ids }: Props = $props();

  function openTitle(title: string) {
    const id = ids.get(titleKey(title));
    if (id !== undefined) openFiche(id);
  }

  const p = $derived(draft.payload);
  const kind = $derived(kindOf(p));
  const fiche = (n: number) => draft.names[n] ?? `fiche n° ${n}`;
  const fact = (n: number) => draft.facts[n]?.text ?? `fait n° ${n}`;
  const title = $derived(
    p.kind === 'fiche'
      ? p.title
      : p.kind === 'contradiction'
        ? fiche(p.ficheId)
        : p.kind === 'doublon'
          ? `${fiche(p.keep)} et ${fiche(p.merge)}`
          : draft.card.title,
  );
  const other = $derived(swapped(p));
</script>

<div class={['item', { active }]} onfocusin={onactivate}>
  <SettingsCard {title}>
    {#snippet aside()}<Badge tone={kind.tone}>{kind.label}</Badge>{/snippet}
    <div class="corps">
      {#if p.kind === 'fiche' && editing}
        <FicheDraftEditor
          draft={p}
          names={draft.names}
          {busy}
          onsubmit={(edited) => onaccept(edited)}
          oncancel={() => onedit(false)}
        />
      {:else}
        {#if p.kind === 'fiche'}
          {#if p.synthesis}<Prose
              text={p.synthesis}
              onLink={openTitle}
              known={(t) => ids.has(titleKey(t))}
            />{/if}
          {#if p.facts.length || p.links.length}
            <ul class="lignes">
              {#each p.facts as f, i (i)}
                <li>
                  {#if f.replaces !== undefined}<s class="barre">{fact(f.replaces)}</s>{/if}
                  <span>{f.text}</span>
                </li>
              {/each}
              {#each p.links as l, i (i)}
                <li class="lien">
                  <span class="muted">{l.relation}</span>
                  <span>{typeof l.to === 'number' ? fiche(l.to) : l.to}</span>
                </li>
              {/each}
            </ul>
          {/if}
        {:else if p.kind === 'contradiction'}
          <ul class="lignes">
            <li><span class="muted">Garder</span> <span>{fact(p.keep)}</span></li>
            <li><span class="muted">Barrer</span> <s class="barre">{fact(p.strike)}</s></li>
          </ul>
          <p class="raison">{p.reason}</p>
        {:else if p.kind === 'doublon'}
          <ul class="lignes">
            <li><span class="muted">Garder</span> <span>{fiche(p.keep)}</span></li>
            <li><span class="muted">Fusionner dedans</span> <span>{fiche(p.merge)}</span></li>
          </ul>
          <p class="raison">{p.reason}</p>
        {:else}
          <ul class="lignes">
            {#each p.fiches.slice(0, 10) as n, i (i)}<li>{n.title}</li>{/each}
            {#if p.fiches.length > 10}<li class="muted">et {p.fiches.length - 10} autres</li>{/if}
          </ul>
          {#each p.warnings as w, i (i)}<p class="raison">{w}</p>{/each}
        {/if}

        {#if error}<p class="erreur" role="alert">{error}</p>{/if}

        <div class="actions">
          <Button
            variant="principal"
            size="petit"
            icon={icons.Check}
            loading={busy}
            aria-keyshortcuts={active ? 'V' : undefined}
            onclick={() => onaccept()}>Valider</Button
          >
          {#if other}
            <Button variant="secondaire" size="petit" disabled={busy} onclick={() => onaccept(other)}
              >Garder l’autre</Button
            >
          {:else if p.kind === 'fiche'}
            <Button
              variant="secondaire"
              size="petit"
              icon={icons.Pencil}
              disabled={busy}
              onclick={() => onedit(true)}>Modifier</Button
            >
          {/if}
          <Button
            variant="fantome"
            size="petit"
            disabled={busy}
            aria-keyshortcuts={active ? 'R' : undefined}
            onclick={onrefuse}>Refuser</Button
          >
          {#if active}<span class="touches" aria-hidden="true"><Kbd>V</Kbd><Kbd>R</Kbd></span>{/if}
        </div>
      {/if}
    </div>
  </SettingsCard>
</div>

<style>
  .item {
    border-radius: var(--r-3);
    transition: box-shadow 120ms ease;
  }
  .item.active {
    box-shadow: 0 0 0 1px var(--accent-bord);
  }
  .corps {
    display: grid;
    gap: 12px;
    padding: 14px 18px 16px;
  }
  .lignes {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 13.5px;
  }
  .lignes li {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
  }
  .muted {
    min-width: 72px;
    color: var(--texte-3);
    font-size: 12.5px;
  }
  .barre {
    color: var(--texte-3);
  }
  .raison {
    margin: 0;
    color: var(--texte-2);
    font-size: 13px;
  }
  .erreur {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .touches {
    display: inline-flex;
    gap: 4px;
    margin-left: auto;
  }
  @media (max-width: 767.98px) {
    .corps {
      padding: 14px;
    }
    .touches {
      display: none;
    }
  }
</style>
