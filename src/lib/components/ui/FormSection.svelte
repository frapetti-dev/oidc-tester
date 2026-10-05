<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';
	import { sectionMemory } from '$lib/state/sections.svelte';

	interface Props {
		/** Stable key for the persisted open state, e.g. `idp.network`. */
		id: string;
		title: string;
		defaultOpen?: boolean;
		/** Shown in the header row next to the title; the caller decides when it is relevant. */
		summary?: Snippet<[open: boolean]>;
		children: Snippet;
	}

	let { id, title, defaultOpen = true, summary, children }: Props = $props();

	const uid = $props.id();
	const memory = sectionMemory();
	const open = $derived(memory.isOpen(id, defaultOpen));
</script>

<section class="border-t border-border first:border-t-0">
	<div class="flex items-center gap-2">
		<button
			type="button"
			class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 text-left text-sm font-semibold text-fg"
			aria-expanded={open}
			aria-controls="{uid}-body"
			onclick={() => memory.set(id, !open)}
		>
			<ChevronRight
				size={14}
				aria-hidden="true"
				class={['shrink-0 transition-transform duration-150', open && 'rotate-90']}
			/>
			{title}
		</button>
		{@render summary?.(open)}
	</div>
	{#if open}
		<div id="{uid}-body" role="group" aria-label={title} class="flex flex-col gap-3 pb-4">
			{@render children()}
		</div>
	{/if}
</section>
