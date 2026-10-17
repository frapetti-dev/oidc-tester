<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import type { WorkspaceSummary } from '#lib/state/repository.js';

	interface Counts {
		idps: number;
		runs: number;
	}

	interface Props {
		open: boolean;
		workspaces: WorkspaceSummary[];
		currentId: string;
		counts: (id: string) => Promise<Counts>;
		onexport: (ids: string[], opts: { runs: boolean; settings: boolean }) => void;
	}

	let { open = $bindable(), workspaces, currentId, counts, onexport }: Props = $props();

	let selected = $state<string[]>([]);
	let includeRuns = $state(false);
	let includeSettings = $state(false);
	let loaded = $state<Record<string, Counts>>({});
	let selectAll = $state<HTMLInputElement | undefined>();

	$effect(() => {
		if (!open) return;
		selected = [currentId];
		includeRuns = false;
		includeSettings = false;
		loaded = {};
		for (const ws of workspaces) {
			counts(ws.id).then(
				(c) => (loaded[ws.id] = c),
				() => (loaded[ws.id] = { idps: 0, runs: 0 })
			);
		}
	});

	const allSelected = $derived(workspaces.length > 0 && selected.length === workspaces.length);
	const noneSelected = $derived(selected.length === 0);

	$effect(() => {
		if (selectAll) selectAll.indeterminate = !allSelected && !noneSelected;
	});

	function plural(n: number, one: string, many: string): string {
		return `${n} ${n === 1 ? one : many}`;
	}

	function summary(id: string): string {
		const c = loaded[id];
		return c ? `${plural(c.idps, 'IdP', 'IdPs')}, ${plural(c.runs, 'run', 'runs')}` : '…';
	}

	function toggleAll(checked: boolean) {
		selected = checked ? workspaces.map((w) => w.id) : [];
	}

	function submit() {
		if (noneSelected) return;
		const ids = workspaces.map((w) => w.id).filter((id) => selected.includes(id));
		open = false;
		onexport(ids, { runs: includeRuns, settings: includeSettings });
	}
</script>

<Modal bind:open title="Export workspaces" size="md" onsubmit={submit}>
	<div class="rounded-control border border-border">
		<label class="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
			<input
				bind:this={selectAll}
				type="checkbox"
				class="check-field"
				checked={allSelected}
				onchange={(event) => toggleAll(event.currentTarget.checked)}
			/>
			Select all
		</label>
		<ul class="max-h-56 overflow-y-auto">
			{#each workspaces as ws (ws.id)}
				<li>
					<label class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-sunken">
						<input type="checkbox" class="check-field" value={ws.id} bind:group={selected} />
						<span class="min-w-0 flex-1 truncate">{ws.name}</span>
						<span class="text-xs text-fg-muted">{summary(ws.id)}</span>
					</label>
				</li>
			{/each}
		</ul>
	</div>
	<div class="space-y-3">
		<div>
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" class="check-field" bind:checked={includeRuns} />
				Include run history
			</label>
			<p class="mt-1 pl-6 text-xs text-fg-muted">
				Runs can contain access and refresh tokens in plain text.
			</p>
		</div>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" class="check-field" bind:checked={includeSettings} />
			Include settings
		</label>
	</div>
	{#snippet aside()}Client secrets and passwords are never exported.{/snippet}
	{#snippet footer()}
		<Button onclick={() => (open = false)}>Cancel</Button>
		<Button type="submit" variant="primary" disabled={noneSelected}>
			Export {plural(selected.length, 'workspace', 'workspaces')}
		</Button>
	{/snippet}
</Modal>
