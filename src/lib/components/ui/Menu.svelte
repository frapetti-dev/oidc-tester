<script lang="ts">
	import { placeMenu, type MenuEntry, type Point } from './menu';

	interface Props {
		at: Point;
		items: MenuEntry[];
		label: string;
		onclose: () => void;
	}

	let { at, items, label, onclose }: Props = $props();

	let root: HTMLDivElement | undefined = $state();

	function buttons(): HTMLButtonElement[] {
		return root ? [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')] : [];
	}

	function move(step: number) {
		const all = buttons();
		if (all.length === 0) return;
		const index = all.indexOf(document.activeElement as HTMLButtonElement);
		const next =
			index === -1 ? (step > 0 ? 0 : all.length - 1) : (index + step + all.length) % all.length;
		all[next].focus();
	}

	// Show in the top layer (above modal dialogs), then place using the measured size.
	$effect(() => {
		if (!root) return;
		root.showPopover();
		const rect = root.getBoundingClientRect();
		const placed = placeMenu(
			at,
			{ width: rect.width, height: rect.height },
			{ width: window.innerWidth, height: window.innerHeight }
		);
		root.style.left = `${placed.x}px`;
		root.style.top = `${placed.y}px`;
		buttons()[0]?.focus();
	});

	$effect(() => {
		function outside(event: PointerEvent) {
			if (root && !root.contains(event.target as Node)) onclose();
		}
		window.addEventListener('pointerdown', outside, true);
		return () => window.removeEventListener('pointerdown', outside, true);
	});

	function onkeydown(event: KeyboardEvent) {
		const all = buttons();
		switch (event.key) {
			case 'ArrowDown':
				move(1);
				break;
			case 'ArrowUp':
				move(-1);
				break;
			case 'Home':
				all[0]?.focus();
				break;
			case 'End':
				all.at(-1)?.focus();
				break;
			case 'Escape':
			case 'Tab':
				onclose();
				break;
			default:
				return;
		}
		event.preventDefault();
		event.stopPropagation();
	}

	function activate(entry: Exclude<MenuEntry, 'separator'>) {
		onclose();
		void entry.onselect();
	}
</script>

<!-- A popover with role=menu is the ARIA menu widget; focus moves between items with the arrows. -->
<div
	bind:this={root}
	popover="manual"
	role="menu"
	aria-label={label}
	tabindex="-1"
	class="fixed m-0 menu"
	{onkeydown}
>
	{#each items as entry, index (index)}
		{#if entry === 'separator'}
			<div role="separator" class="my-1 h-px bg-border"></div>
		{:else}
			<button
				type="button"
				role="menuitem"
				tabindex="-1"
				class={['menu-item', entry.danger && 'text-danger']}
				disabled={entry.disabled}
				onclick={() => activate(entry)}
			>
				<span class="flex-1 truncate">{entry.label}</span>
				{#if entry.shortcut}<span class="text-xs text-fg-muted">{entry.shortcut}</span>{/if}
			</button>
		{/if}
	{/each}
</div>
