<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fly } from 'svelte/transition';

	interface Props {
		open: boolean;
		children: Snippet;
	}

	let { open = $bindable(), children }: Props = $props();

	let panel: HTMLDivElement | undefined = $state();

	// Focus moves into the drawer on open and back to the previous element on close.
	$effect(() => {
		if (!open || !panel) return;
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		panel
			.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]')
			?.focus();
		return () => previous?.focus();
	});

	function close() {
		open = false;
	}
</script>

<svelte:window onkeydown={(event) => open && event.key === 'Escape' && close()} />

{#if open}
	<!-- The scrim is a pointer shortcut only; Escape and the titlebar toggle are the keyboard paths. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="fixed inset-x-0 top-10 bottom-0 z-30 bg-scrim" onclick={close}></div>
	<div
		bind:this={panel}
		role="dialog"
		aria-modal="true"
		aria-label="Sidebar navigation"
		class="fixed top-10 bottom-0 left-0 z-40 w-72 max-w-[85vw] border-r border-border bg-surface-raised shadow-float"
		transition:fly={{ x: -16, duration: 140 }}
	>
		{@render children()}
	</div>
{/if}
