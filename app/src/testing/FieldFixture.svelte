<script lang="ts">
  import Field from '../lib/ui/Field.svelte';
  import TextInput from '../lib/ui/TextInput.svelte';

  let { hint, error }: { hint?: string | undefined; error?: string | undefined } = $props();
  let value = $state('48 21');
</script>

<Field label="Code d’appairage" {hint} {error}>
  <TextInput bind:value />
</Field>
