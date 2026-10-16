<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import { placeMenu } from './menu';

	interface Props {
		/** Accessible name of the trigger button, e.g. `About iss`. */
		label: string;
		/** Tooltip content. */
		text: string;
	}

	let { label, text }: Props = $props();

	const id = $props.id();
	let button: HTMLButtonElement | undefined = $state();
	let tip: HTMLDivElement | undefined = $state();

	// Top-layer popover so the tooltip is never clipped by scroll containers or panels.
	function show() {
		if (!button || !tip || tip.matches(':popover-open')) return;
		tip.showPopover();
		const size = tip.getBoundingClientRect();
		const anchor = button.getBoundingClientRect();
		const placed = placeMenu(
			{ x: anchor.left, y: anchor.bottom + 4 },
			{ width: size.width, height: size.height },
			{ width: window.innerWidth, height: window.innerHeight }
		);
		tip.style.left = `${placed.x}px`;
		tip.style.top = `${placed.y}px`;
	}

	function hide() {
		if (tip?.matches(':popover-open')) tip.hidePopover();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		hide();
		event.stopPropagation();
	}
</script>

<button
	bind:this={button}
	type="button"
	class="-my-0.5 inline-grid size-5 shrink-0 cursor-help place-items-center rounded-full text-fg-muted hover:text-fg"
	aria-label={label}
	aria-describedby={id}
	onpointerenter={show}
	onpointerleave={hide}
	onfocus={show}
	onblur={hide}
	{onkeydown}
	onclick={() => (tip?.matches(':popover-open') ? hide() : show())}
>
	<Info size={13} aria-hidden="true" />
</button>
<div
	bind:this={tip}
	{id}
	role="tooltip"
	popover="manual"
	class="fixed m-0 max-w-72 rounded-menu border border-border bg-surface-raised px-2.5 py-1.5 text-xs leading-snug text-fg shadow-float"
>
	{text}
</div>
