<script lang="ts">
	import ContextMenuHost from './ContextMenuHost.svelte';

	interface Props {
		type?: 'text' | 'password';
		readonly?: boolean;
		initial?: string;
	}

	let { type = 'text', readonly = false, initial = 'hello world' }: Props = $props();
	// svelte-ignore state_referenced_locally
	let value = $state(initial);
</script>

<label>
	Field
	{#if type === 'password'}
		<input type="password" {readonly} bind:value />
	{:else}
		<input type="text" {readonly} bind:value />
	{/if}
</label>
<div data-testid="plain">Plain text</div>
<output data-testid="mirror">{value}</output>
<ContextMenuHost />
