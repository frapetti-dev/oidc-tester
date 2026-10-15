<script lang="ts">
	import type { Component } from 'svelte';

	interface Props {
		/** Lucide icon component; decorative. */
		icon: Component<{ class?: string; strokeWidth?: number; 'aria-hidden'?: 'true' }>;
		title: string;
		/** One line on what fills this area and how. */
		description?: string;
		/** Fill and center in the whole parent; off to sit inline between other content. */
		fill?: boolean;
	}

	let { icon: Icon, title, description, fill = true }: Props = $props();
</script>

<div
	class={[
		'flex flex-col items-center justify-center gap-3 p-6 text-center text-fg-muted',
		fill ? 'h-full min-h-48' : 'py-10'
	]}
>
	<Icon class="size-10 opacity-60" strokeWidth={1.5} aria-hidden="true" />
	<div class="flex max-w-72 flex-col gap-1">
		<p class="text-base font-medium">{title}</p>
		{#if description}
			<p class="text-sm text-balance opacity-80">{description}</p>
		{/if}
	</div>
</div>
