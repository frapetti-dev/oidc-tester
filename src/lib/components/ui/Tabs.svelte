<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Tab {
		id: string;
		label: string;
	}

	interface Props {
		tabs: Tab[];
		/** Id of the selected tab; defaults to the first tab. */
		active?: string;
		label?: string;
		/** Renders the content of the selected tab. */
		panel: Snippet<[string]>;
	}

	let { tabs, active = $bindable(), label, panel }: Props = $props();

	const uid = $props.id();
	const current = $derived(tabs.some((t) => t.id === active) ? active : tabs[0]?.id);

	function select(index: number, list: HTMLElement) {
		const target = tabs[(index + tabs.length) % tabs.length];
		active = target.id;
		list.querySelector<HTMLElement>(`#${CSS.escape(`${uid}-tab-${target.id}`)}`)?.focus();
	}

	function onkeydown(event: KeyboardEvent & { currentTarget: HTMLElement }, index: number) {
		const list = event.currentTarget.parentElement;
		if (!list) return;
		if (event.key === 'ArrowRight') select(index + 1, list);
		else if (event.key === 'ArrowLeft') select(index - 1, list);
		else if (event.key === 'Home') select(0, list);
		else if (event.key === 'End') select(tabs.length - 1, list);
		else return;
		event.preventDefault();
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div role="tablist" aria-label={label} class="flex shrink-0 border-b border-border">
		{#each tabs as tab, i (tab.id)}
			<button
				type="button"
				role="tab"
				id="{uid}-tab-{tab.id}"
				aria-selected={tab.id === current}
				aria-controls="{uid}-panel"
				tabindex={tab.id === current ? 0 : -1}
				class={['tab', tab.id === current && 'tab-active']}
				onclick={() => (active = tab.id)}
				onkeydown={(event) => onkeydown(event, i)}
			>
				{tab.label}
			</button>
		{/each}
	</div>
	{#if current}
		<div
			role="tabpanel"
			id="{uid}-panel"
			aria-labelledby="{uid}-tab-{current}"
			class="min-h-0 flex-1 overflow-auto"
		>
			{@render panel(current)}
		</div>
	{/if}
</div>
