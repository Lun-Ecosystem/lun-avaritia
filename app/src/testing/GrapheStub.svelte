<script lang="ts">
  /* Stands for the graph in the tests of the memory: jsdom has no WebGL. */
  let { selected }: { selected: number | null } = $props();
</script>

<p>Graphe chargé {selected ?? ''}</p>
