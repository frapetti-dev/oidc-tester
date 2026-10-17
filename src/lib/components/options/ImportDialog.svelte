<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import type { BundleEntry } from '#lib/model/workspaceFile.js';

	interface Props {
		open: boolean;
		entries: BundleEntry[];
		hasSettings: boolean;
		onimport: (entries: BundleEntry[], applySettings: boolean) => void;
	}

	let { open = $bindable(), entries, hasSettings, onimport }: Props = $props();

	let selected = $state<number[]>([]);
	let applySettings = $state(false);

	$effect(() => {
		if (!open) return;
		selected = entries.map((_, i) => i);
		applySettings = false;
	});

	function plural(n: number, one: string, many: string): string {
		return `${n} ${n === 1 ? one : many}`;
	}

	function submit() {
		if (selected.length === 0) return;
		const chosen = entries.filter((_, i) => selected.includes(i));
		open = false;
		onimport(chosen, hasSettings && applySettings);
	}
</script>

<Modal bind:open title="Import workspaces" size="md" onsubmit={submit}>
	<ul class="rounded-control border border-border">
		{#each entries as entry, i (i)}
			<li class="not-first:border-t not-first:border-border">
				<label class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-sunken">
					<input type="checkbox" class="check-field" value={i} bind:group={selected} />
					<span class="min-w-0 flex-1 truncate">{entry.workspace.name}</span>
					<span class="text-xs text-fg-muted">
						{plural(entry.workspace.idps.length, 'IdP', 'IdPs')}, {plural(
							entry.runs.length,
							'run',
							'runs'
						)}
					</span>
				</label>
			</li>
		{/each}
	</ul>
	{#if hasSettings}
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" class="check-field" bind:checked={applySettings} />
			Apply settings from file
		</label>
	{/if}
	{#snippet aside()}Imported workspaces are added next to the existing ones.{/snippet}
	{#snippet footer()}
		<Button onclick={() => (open = false)}>Cancel</Button>
		<Button type="submit" variant="primary" disabled={selected.length === 0}>
			Import {plural(selected.length, 'workspace', 'workspaces')}
		</Button>
	{/snippet}
</Modal>
