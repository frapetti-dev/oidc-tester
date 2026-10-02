<script lang="ts">
	import Badge from './Badge.svelte';
	import Toggle from './Toggle.svelte';

	let { checked = $bindable(false) }: { checked?: boolean } = $props();
</script>

<div class="flex items-center gap-2">
	<Toggle label="Skip TLS validation" bind:checked />
	{#if checked}
		<Badge variant="danger">TLS validation disabled</Badge>
	{/if}
</div>
