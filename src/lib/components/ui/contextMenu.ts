import type { Attachment } from 'svelte/attachments';
import { contextMenu } from '$lib/state/contextMenu.svelte';
import type { MenuEntry } from './menu';

/**
 * Opens `items()` as a context menu on right-click, the ContextMenu key or Shift+F10. A
 * non-empty text selection inside the element adds a leading `Copy`. The event does not bubble,
 * so the innermost element with a menu wins.
 */
export function menu(items: () => MenuEntry[], label: string): Attachment<HTMLElement> {
	return (node) => {
		function oncontextmenu(event: MouseEvent) {
			event.preventDefault();
			event.stopPropagation();
			const entries = items();
			const selection = window.getSelection();
			const text = selection?.toString() ?? '';
			if (selection && text !== '' && selection.containsNode(node, true)) {
				entries.unshift({ label: 'Copy', onselect: () => contextMenu.copy(text) }, 'separator');
			}
			contextMenu.open({ x: event.clientX, y: event.clientY }, entries, label, node);
		}

		function onkeydown(event: KeyboardEvent) {
			if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
				event.preventDefault();
				event.stopPropagation();
				contextMenu.openAt(node, items(), label);
			}
		}

		node.addEventListener('contextmenu', oncontextmenu);
		node.addEventListener('keydown', onkeydown);
		return () => {
			node.removeEventListener('contextmenu', oncontextmenu);
			node.removeEventListener('keydown', onkeydown);
		};
	};
}
