<script lang="ts">
	import type { IpcApi } from '$lib/ipc/types';
	import type { Run } from '$lib/model/run';
	import { toCurl } from '$lib/export/curl';
	import { toHar } from '$lib/export/har';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ExchangeDetail from './ExchangeDetail.svelte';
	import { buildTimeline, filterEntries, type TimelineFilter } from './entries';

	interface Props {
		ipc: IpcApi;
		run: Run | null;
		runs: Run[];
		onselectrun: (runId: string) => void;
		ondeleterun: (runId: string) => void;
		appVersion: string;
	}

	let { ipc, run, runs, onselectrun, ondeleterun, appVersion }: Props = $props();

	const FILTERS: { value: TimelineFilter; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'nav', label: 'NAV' },
		{ value: 'http', label: 'HTTP' }
	];
	const STATUS_VARIANT = { success: 'success', error: 'danger', cancelled: 'warning' } as const;

	let filter = $state<TimelineFilter>('all');
	let selection = $state<{ runId: string; index: number } | null>(null);
	let notice = $state('');

	const all = $derived(run ? buildTimeline(run) : []);
	const entries = $derived(filterEntries(all, filter));
	const selected = $derived(
		run && selection?.runId === run.id ? (all[selection.index] ?? null) : null
	);

	function statusVariant(status: number) {
		return status >= 400 ? 'danger' : status >= 300 ? 'warning' : 'success';
	}

	async function copyCurl() {
		if (selected?.type !== 'http' || !run) return;
		const { tlsInsecure, proxy } = run.idpSnapshot.http;
		try {
			await navigator.clipboard.writeText(toCurl(selected.exchange, { tlsInsecure, proxy }));
			notice = 'cURL copied';
		} catch {
			notice = 'Could not copy cURL';
		}
	}

	/** REQ-TL-005 */
	async function saveHar() {
		if (!run) return;
		const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..*$/, '');
		const path = await ipc.pickSavePath({
			defaultPath: `${run.flowSnapshot.name}-${stamp}.har`,
			filters: [{ name: 'HAR', extensions: ['har'] }]
		});
		if (path === null) return;
		try {
			await ipc.writeTextFile(path, JSON.stringify(toHar(run, appVersion), null, 2));
			notice = `HAR saved to ${path}`;
		} catch (e) {
			notice = `Could not save HAR: ${e instanceof Error ? e.message : String(e)}`;
		}
	}
</script>

<div class="flex h-full flex-col gap-3 overflow-auto p-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div role="group" aria-label="Filter entries" class="flex gap-1">
			{#each FILTERS as f (f.value)}
				<Button
					variant={filter === f.value ? 'primary' : 'ghost'}
					aria-pressed={filter === f.value}
					onclick={() => (filter = f.value)}>{f.label}</Button
				>
			{/each}
		</div>
		<Button disabled={!run} onclick={saveHar}>Save HAR</Button>
	</div>
	{#if notice}
		<p class="text-xs text-fg-muted" role="status">{notice}</p>
	{/if}

	{#if entries.length === 0}
		<p class="text-sm text-fg-muted">No requests yet</p>
	{:else}
		<ul class="divide-y divide-border panel" aria-label="Timeline">
			{#each entries as entry (all.indexOf(entry))}
				{@const index = all.indexOf(entry)}
				<li>
					<button
						type="button"
						class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface-sunken"
						aria-current={selection?.index === index && selected !== null}
						onclick={() => run && (selection = { runId: run.id, index })}
					>
						{#if entry.type === 'nav'}
							<Badge>NAV</Badge>
							<span class="min-w-0 flex-1 truncate font-mono">{entry.url}</span>
						{:else}
							<span
								class={[
									'badge',
									entry.exchange.request.method === 'GET' ? 'text-method-get' : 'text-method-post'
								]}>{entry.exchange.request.method}</span
							>
							<Badge variant={statusVariant(entry.exchange.response.status)}
								>{entry.exchange.response.status}</Badge
							>
							<span class="min-w-0 flex-1 truncate font-mono">{entry.exchange.request.url}</span>
							<span class="text-fg-muted">{entry.exchange.durationMs} ms</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if selected}
		<section class="flex flex-col gap-3 panel p-3" aria-label="Entry detail">
			{#if selected.type === 'nav'}
				<h3 class="field-label">Navigation</h3>
				<p class="font-mono text-xs break-all">{selected.url}</p>
				<p class="text-xs text-fg-muted">{selected.at}</p>
			{:else}
				{@const { request, response } = selected.exchange}
				<div class="flex items-center justify-between gap-2">
					<h3 class="font-mono text-xs break-all">{request.method} {request.url}</h3>
					<Button onclick={copyCurl}>Copy cURL</Button>
				</div>
				<p class="text-xs text-fg-muted">
					{response.status}
					{response.statusText} · {response.httpVersion} · {selected.exchange.durationMs} ms
				</p>
				<ExchangeDetail title="Request" headers={request.headers} body={request.body} />
				<ExchangeDetail title="Response" headers={response.headers} body={response.body} />
			{/if}
		</section>
	{/if}

	<section aria-label="History" class="flex flex-col gap-1">
		<h3 class="field-label">History</h3>
		{#if runs.length === 0}
			<p class="text-xs text-fg-muted">No past runs</p>
		{:else}
			<ul class="divide-y divide-border panel">
				{#each runs as r (r.id)}
					<li class="flex items-center gap-2 px-3 py-1.5 text-xs">
						<span class="text-fg-muted">{new Date(r.startedAt).toLocaleString()}</span>
						<span class="min-w-0 flex-1 truncate">{r.flowSnapshot.name}</span>
						<Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
						<Button
							variant={run?.id === r.id ? 'primary' : 'ghost'}
							aria-label="Open run {r.flowSnapshot.name} {r.startedAt}"
							onclick={() => onselectrun(r.id)}>Open</Button
						>
						<Button
							variant="danger"
							aria-label="Delete run {r.flowSnapshot.name} {r.startedAt}"
							onclick={() => ondeleterun(r.id)}>Delete</Button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
