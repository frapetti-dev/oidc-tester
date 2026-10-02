<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		start: Snippet;
		end: Snippet;
		/** Width in px of the fixed pane; the other pane takes the remaining space. */
		size?: number;
		min?: number;
		max?: number;
		/** Which pane keeps `size`. */
		fixed?: 'start' | 'end';
		label?: string;
	}

	const STEP = 16;

	let {
		start,
		end,
		size = $bindable(280),
		min = 160,
		max = 800,
		fixed = 'start',
		label = 'Resize panes'
	}: Props = $props();

	let drag = $state<{ originX: number; originSize: number } | null>(null);
	const current = $derived(Math.min(max, Math.max(min, size)));
	// Growing direction of the fixed pane relative to handle movement to the right.
	const sign = $derived(fixed === 'start' ? 1 : -1);

	function resize(next: number) {
		size = Math.min(max, Math.max(min, next));
	}

	function onpointerdown(event: PointerEvent) {
		if (event.button !== 0) return;
		drag = { originX: event.clientX, originSize: current };
		event.preventDefault();
	}

	function onpointermove(event: PointerEvent) {
		if (drag) resize(drag.originSize + sign * (event.clientX - drag.originX));
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowRight') resize(current + sign * STEP);
		else if (event.key === 'ArrowLeft') resize(current - sign * STEP);
		else if (event.key === 'Home') resize(min);
		else if (event.key === 'End') resize(max);
		else return;
		event.preventDefault();
	}
</script>

<svelte:window
	{onpointermove}
	onpointerup={() => (drag = null)}
	onpointercancel={() => (drag = null)}
/>

<div class={['flex h-full min-h-0 w-full min-w-0', drag && 'select-none']}>
	<div
		class={['min-w-0', fixed === 'start' ? 'shrink-0' : 'flex-1']}
		style:width={fixed === 'start' ? `${current}px` : undefined}
	>
		{@render start()}
	</div>
	<!-- Focusable separator = ARIA "window splitter" widget; Svelte's a11y lint does not model it. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		role="separator"
		aria-orientation="vertical"
		aria-label={label}
		aria-valuenow={current}
		aria-valuemin={min}
		aria-valuemax={max}
		tabindex="0"
		class={[
			'w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
			drag && 'bg-accent'
		]}
		{onpointerdown}
		{onkeydown}
	></div>
	<div
		class={['min-w-0', fixed === 'end' ? 'shrink-0' : 'flex-1']}
		style:width={fixed === 'end' ? `${current}px` : undefined}
	>
		{@render end()}
	</div>
</div>
