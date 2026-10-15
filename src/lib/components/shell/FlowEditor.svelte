<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Name of the selected flow; shown as the heading. */
		title?: string;
		/** Right-aligned controls in the title row (e.g. Run). */
		actions?: Snippet;
		/** The editor body; without it the empty state is shown. */
		children?: Snippet;
	}

	let { title, actions, children }: Props = $props();
</script>

<main aria-label="Flow editor" class="flex h-full min-h-0 flex-col bg-surface-raised">
	{#if children}
		{#if title}
			<div class="flex shrink-0 items-center gap-3 px-5 pt-4 pb-1">
				<h1 class="min-w-0 flex-1 text-xl font-semibold tracking-tight wrap-break-word">
					{title}
				</h1>
				{@render actions?.()}
			</div>
		{/if}
		<div class="flex min-h-0 flex-1 flex-col">{@render children()}</div>
	{:else}
		<div class="flex flex-1 items-center justify-center p-6 text-sm text-fg-muted">
			No flow selected
		</div>
	{/if}
</main>
