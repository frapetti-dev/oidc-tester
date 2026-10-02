<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Name of the selected flow; shown as the heading. */
		title?: string;
		/** The editor body; without it the empty state is shown. */
		children?: Snippet;
	}

	let { title, children }: Props = $props();
</script>

<main aria-label="Flow editor" class="flex h-full min-h-0 flex-col">
	{#if children}
		{#if title}
			<h1 class="shrink-0 border-b border-border px-4 py-2 text-base font-semibold">{title}</h1>
		{/if}
		<div class="min-h-0 flex-1 overflow-auto p-4">{@render children()}</div>
	{:else}
		<div class="flex flex-1 items-center justify-center p-6 text-sm text-fg-muted">
			No flow selected
		</div>
	{/if}
</main>
