<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		start: Snippet;
		end: Snippet;
		/** Size in px of the fixed pane (width, or height when vertical); the other pane takes the rest. */
		size?: number;
		min?: number;
		max?: number;
		/** Which pane keeps `size`. */
		fixed?: 'start' | 'end';
		label?: string;
		/** `horizontal`: panes side by side. `vertical`: panes stacked. */
		orientation?: 'horizontal' | 'vertical';
	}

	const STEP = 16;

	let {
		start,
		end,
		size = $bindable(280),
		min = 160,
		max = 800,
		fixed = 'start',
		label = 'Resize panes',
		orientation = 'horizontal'
	}: Props = $props();

	const vertical = $derived(orientation === 'vertical');
	let drag = $state<{ origin: number; originSize: number } | null>(null);
	const current = $derived(Math.min(max, Math.max(min, size)));
	// Growing direction of the fixed pane relative to handle movement to the right/down.
	const sign = $derived(fixed === 'start' ? 1 : -1);

	function resize(next: number) {
		size = Math.min(max, Math.max(min, next));
	}

	function onpointerdown(event: PointerEvent) {
		if (event.button !== 0) return;
		drag = { origin: vertical ? event.clientY : event.clientX, originSize: current };
		event.preventDefault();
	}

	function onpointermove(event: PointerEvent) {
		if (drag)
			resize(drag.originSize + sign * ((vertical ? event.clientY : event.clientX) - drag.origin));
	}

	function onkeydown(event: KeyboardEvent) {
		const grow = vertical ? 'ArrowDown' : 'ArrowRight';
		const shrink = vertical ? 'ArrowUp' : 'ArrowLeft';
		if (event.key === grow) resize(current + sign * STEP);
		else if (event.key === shrink) resize(current - sign * STEP);
		else if (event.key === 'Home') resize(min);
		else if (event.key === 'End') resize(max);
		else return;
		event.preventDefault();
	}

	const startStyle = $derived(`${vertical ? 'height' : 'width'}: ${current}px`);
</script>

<svelte:window
	{onpointermove}
	onpointerup={() => (drag = null)}
	onpointercancel={() => (drag = null)}
/>

<div class={['flex h-full min-h-0 w-full min-w-0', vertical && 'flex-col', drag && 'select-none']}>
	<div
		class={['min-h-0 min-w-0', fixed === 'start' ? 'shrink-0' : 'flex-1']}
		style={fixed === 'start' ? startStyle : undefined}
	>
		{@render start()}
	</div>
	<!-- Focusable separator = ARIA "window splitter" widget; Svelte's a11y lint does not model it. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		role="separator"
		aria-orientation={vertical ? 'horizontal' : 'vertical'}
		aria-label={label}
		aria-valuenow={current}
		aria-valuemin={min}
		aria-valuemax={max}
		tabindex="0"
		class={[
			'relative shrink-0 bg-border transition-colors before:absolute hover:bg-focus focus-visible:bg-focus focus-visible:outline-none',
			vertical
				? 'h-px w-full cursor-row-resize before:inset-x-0 before:-inset-y-0.5'
				: 'h-full w-px cursor-col-resize before:-inset-x-0.5 before:inset-y-0',
			drag && 'bg-focus'
		]}
		{onpointerdown}
		{onkeydown}
	></div>
	<div
		class={['min-h-0 min-w-0', fixed === 'end' ? 'shrink-0' : 'flex-1']}
		style={fixed === 'end' ? startStyle : undefined}
	>
		{@render end()}
	</div>
</div>
