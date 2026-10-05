<script lang="ts">
	import type { Snippet } from 'svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';

	interface Props {
		/** Selected tab id: `tokens`, `errors` or `timeline`. */
		active?: string;
		tokens?: Snippet;
		errors?: Snippet;
		timeline?: Snippet;
	}

	let { active = $bindable('tokens'), tokens, errors, timeline }: Props = $props();

	const TABS = [
		{ id: 'tokens', label: 'Tokens' },
		{ id: 'errors', label: 'Errors' },
		{ id: 'timeline', label: 'Timeline' }
	];
	const content = $derived<Record<string, Snippet | undefined>>({ tokens, errors, timeline });
	const EMPTY: Record<string, string> = {
		tokens: 'No run yet',
		errors: 'No errors',
		timeline: 'No requests yet'
	};
</script>

<section aria-label="Results" class="flex h-full min-h-0 flex-col bg-surface-raised">
	<Tabs label="Results" tabs={TABS} bind:active>
		{#snippet panel(id)}
			{@const body = content[id]}
			{#if body}
				{@render body()}
			{:else}
				<p class="p-6 text-center text-sm text-fg-muted">{EMPTY[id]}</p>
			{/if}
		{/snippet}
	</Tabs>
</section>
