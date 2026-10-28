<script lang="ts">
  import Field from '../lib/ui/Field.svelte';
  import TextArea from '../lib/ui/TextArea.svelte';

  let value = $state('Texte');
</script>

<Field label="Synthèse">
  <TextArea bind:value />
</Field>
<p>Valeur : {value}</p>
