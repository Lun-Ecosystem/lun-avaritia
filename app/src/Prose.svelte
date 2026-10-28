<script lang="ts">
  import { tokens, type Token } from './markdown.ts';

  /* A synthesis rendered by Svelte from its tokens, never as HTML. A [[Fiche]] link is a button. */

  type Props = {
    text: string;
    onLink?: ((title: string) => void) | undefined;
    /** Only a known title is a button; without it every link is one. */
    known?: ((title: string) => boolean) | undefined;
  };

  let { text, onLink, known }: Props = $props();

  const paras = $derived(
    tokens(text).reduce<Token[][]>(
      (acc, t) => {
        if (t.kind === 'para') acc.push([]);
        else acc[acc.length - 1]!.push(t);
        return acc;
      },
      [[]],
    ),
  );
</script>

<div class="prose">
  {#each paras as para, i (i)}
    <p>
      {#each para as t, j (j)}
        {#if t.kind === 'break'}<br />
        {:else if t.kind === 'strong'}<strong>{t.text}</strong>
        {:else if t.kind === 'em'}<em>{t.text}</em>
        {:else if t.kind === 'link'}
          {#if onLink && (!known || known(t.text))}
            <button type="button" class="lien" onclick={() => onLink(t.text)}>{t.text}</button>
          {:else}<span class="lien">{t.text}</span>{/if}
        {:else if t.kind === 'text'}{t.text}{/if}
      {/each}
    </p>
  {/each}
</div>

<style>
  .prose p {
    margin: 0 0 8px;
    line-height: 1.6;
  }
  .prose p:last-child {
    margin-bottom: 0;
  }
  strong {
    font-weight: 500;
  }
  .lien {
    padding: 0;
    border: 0;
    border-bottom: 1px dotted var(--accent-texte);
    background: none;
    color: var(--accent-texte);
    font: inherit;
  }
  button.lien {
    cursor: pointer;
  }
  button.lien:focus-visible {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }
</style>
