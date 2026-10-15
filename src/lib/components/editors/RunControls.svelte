<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import Button from '#lib/components/ui/Button.svelte';

	interface Props {
		running: boolean;
		onrun: () => void;
		oncancel: () => void;
	}

	let { running, onrun, oncancel }: Props = $props();
</script>

<div class="flex shrink-0 items-center gap-2">
	{#if running}
		<Button variant="danger" size="lg" onclick={oncancel}>Cancel</Button>
	{/if}
	<Button variant="primary" size="lg" disabled={running} onclick={onrun}>
		<Play size={16} aria-hidden="true" />
		{running ? 'Running…' : 'Run'}
	</Button>
</div>
