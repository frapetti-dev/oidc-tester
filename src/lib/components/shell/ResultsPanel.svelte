<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ListTree from '@lucide/svelte/icons/list-tree';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
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
	const EMPTY: Record<string, { icon: Component; title: string }> = {
		tokens: { icon: KeyRound, title: 'No run yet' },
		errors: { icon: ShieldCheck, title: 'No errors' },
		timeline: { icon: ListTree, title: 'No requests yet' }
	};
</script>

<section aria-label="Results" class="flex h-full min-h-0 flex-col bg-surface-raised">
	<Tabs label="Results" tabs={TABS} bind:active>
		{#snippet panel(id)}
			{@const body = content[id]}
			{#if body}
				{@render body()}
			{:else}
				<EmptyState {...EMPTY[id]} />
			{/if}
		{/snippet}
	</Tabs>
</section>
