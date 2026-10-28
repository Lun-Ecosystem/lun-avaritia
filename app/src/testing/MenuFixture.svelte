<script lang="ts">
  import Menu from '../lib/ui/Menu.svelte';
  import type { MenuSection } from '../lib/ui/types.ts';

  let { onselect }: { onselect: (id: string) => void } = $props();

  const sections: MenuSection[] = [
    { title: 'Suggéré', items: [{ id: 'factures', label: 'Factures', tone: 'ia' }] },
    {
      title: 'Boîtes',
      items: [
        { id: 'administratif', label: 'Administratif', shortcut: '2' },
        { id: 'newsletters', label: 'Newsletters', shortcut: '3' },
      ],
    },
    { fixed: true, items: [{ id: 'nouvelle', label: 'Nouvelle boîte…' }] },
  ];
</script>

<Menu {sections} filter="Filtrer les boîtes" {onselect}>
  {#snippet trigger({ props })}
    <button {...props}>Ranger dans</button>
  {/snippet}
</Menu>
