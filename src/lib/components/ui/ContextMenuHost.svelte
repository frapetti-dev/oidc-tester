<script lang="ts">
	import { contextMenu } from '$lib/state/contextMenu.svelte';
	import { editMenu, isEditableText } from './editMenu';
	import Menu from './Menu.svelte';

	// Fallback for every right-click not claimed by a `menu` attachment: the WebView2 default
	// menu never shows; text fields get the edit menu, a text selection gets Copy.
	function fallback(event: MouseEvent) {
		event.preventDefault();
		const at = { x: event.clientX, y: event.clientY };
		if (isEditableText(event.target)) {
			contextMenu.open(at, editMenu(event.target), 'Edit', event.target);
			return;
		}
		const text = window.getSelection()?.toString() ?? '';
		if (text !== '') {
			contextMenu.open(
				at,
				[{ label: 'Copy', onselect: () => contextMenu.copy(text) }],
				'Selection',
				null
			);
		}
	}
</script>

<svelte:window
	oncontextmenu={fallback}
	onblur={() => contextMenu.close()}
	onresize={() => contextMenu.close()}
/>

{#key contextMenu.current}
	{#if contextMenu.current}
		<Menu
			at={contextMenu.current.at}
			items={contextMenu.current.items}
			label={contextMenu.current.label}
			onclose={() => contextMenu.close()}
		/>
	{/if}
{/key}

<div
	role="status"
	aria-live="polite"
	class="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2"
>
	{#if contextMenu.notice}
		<div class="rounded-full bg-fg px-3 py-1 text-xs text-surface shadow-float">
			{contextMenu.notice}
		</div>
	{/if}
</div>
