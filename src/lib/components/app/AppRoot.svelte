<script lang="ts">
	import { onMount } from 'svelte';
	import pkg from '../../../../package.json';
	import ClientForm from '#lib/components/editors/ClientForm.svelte';
	import FlowForm from '#lib/components/editors/FlowForm.svelte';
	import IdpForm, { type DiscoveryOutcome } from '#lib/components/editors/IdpForm.svelte';
	import RunControls from '#lib/components/editors/RunControls.svelte';
	import ErrorsPanel from '#lib/components/results/ErrorsPanel.svelte';
	import TokensPanel from '#lib/components/results/TokensPanel.svelte';
	import Drawer from '#lib/components/shell/Drawer.svelte';
	import FlowEditor from '#lib/components/shell/FlowEditor.svelte';
	import ResultsPanel from '#lib/components/shell/ResultsPanel.svelte';
	import Sidebar from '#lib/components/shell/Sidebar.svelte';
	import TitleBar from '#lib/components/shell/TitleBar.svelte';
	import type { SidebarClient, SidebarFlow, SidebarIdp } from '#lib/components/shell/types.js';
	import TimelinePanel from '#lib/components/timeline/TimelinePanel.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import ContextMenuHost from '#lib/components/ui/ContextMenuHost.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import type { MenuEntry } from '#lib/components/ui/menu.js';
	import SplitPane from '#lib/components/ui/SplitPane.svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';
	import type { IpcApi } from '#lib/ipc/types.js';
	import {
		FLOW_TYPES,
		FLOW_TYPE_LABELS,
		SCRATCHPAD_ID,
		type Client,
		type Flow,
		type Idp
	} from '#lib/model/schema.js';
	import { callUserInfo, executeRun } from '#lib/run/engine.js';
	import { tabForRun } from '#lib/run/tabs.js';
	import { errorMessage } from '#lib/state/secrets.js';
	import { RunnerStore } from '#lib/state/runner.svelte.js';
	import { WorkspaceStore } from '#lib/state/workspace.svelte.js';
	import { layoutMode } from './layout';

	interface Props {
		ipc: IpcApi;
	}

	let { ipc }: Props = $props();

	// The host is fixed for the lifetime of the app.
	// svelte-ignore state_referenced_locally
	const store = new WorkspaceStore(ipc);
	// svelte-ignore state_referenced_locally
	const runner = new RunnerStore({
		ipc,
		repo: store.repo,
		execute: executeRun,
		userInfo: callUserInfo,
		appVersion: pkg.version
	});

	/** REQ-UI-008: how long a finished run keeps the titlebar indicator green/red. */
	const OUTCOME_MS = 2400;

	type DialogKind =
		| 'saveAs'
		| 'rename'
		| 'delete'
		| 'deleteIdp'
		| 'deleteClient'
		| 'deleteFlow'
		| 'renameIdp'
		| 'renameClient'
		| 'renameFlow';
	interface DialogTarget {
		idpId?: string;
		clientId?: string;
		flowId?: string;
	}
	let dialog = $state<({ kind: DialogKind } & DialogTarget) | null>(null);
	let dialogOpen = $state(false);
	let resultsTab = $state('tokens');
	let editorTab = $state('flow');

	let width = $state(0);
	const mode = $derived(layoutMode(width));
	let drawerOpen = $state(false);
	let maximized = $state(false);
	let outcome = $state<'success' | 'error' | null>(null);
	let outcomeTimer: number | undefined;

	const workspaceId = $derived(store.current?.id ?? SCRATCHPAD_ID);
	const idp = $derived(store.selectedIdp);
	const client = $derived(store.selectedClient);
	const flow = $derived(store.selectedFlow);
	const idpRuns = $derived(idp ? runner.runs.filter((r) => r.idpId === idp.id) : runner.runs);
	const clientRuns = $derived(
		client ? runner.runs.filter((r) => r.clientId === client.id) : runner.runs
	);
	const editorTabs = $derived.by(() => {
		const tabs: Array<{ id: 'flow' | 'client' | 'idp'; label: string }> = [];
		if (flow) tabs.push({ id: 'flow', label: 'Flow' });
		if (client) tabs.push({ id: 'client', label: 'Client' });
		tabs.push({ id: 'idp', label: 'IdP' });
		return tabs;
	});
	const activeEditorTab = $derived(
		editorTabs.some((t) => t.id === editorTab) ? editorTab : editorTabs[0].id
	);
	const editorTitle = $derived(
		activeEditorTab === 'flow' && flow
			? flow.name
			: activeEditorTab === 'client' && client
				? client.name
				: (idp?.name ?? '')
	);
	const canUserInfo = $derived(
		(runner.shown?.idpSnapshot.endpoints.userinfo ?? '') !== '' &&
			runner.shown?.flowSnapshot.params.scope.split(/\s+/).includes('openid') === true
	);
	const isScratchpad = $derived(workspaceId === SCRATCHPAD_ID);
	const runState = $derived(runner.running ? 'running' : (outcome ?? 'idle'));

	onMount(() => {
		void store.init();
		const syncMaximized = () => void ipc.windowIsMaximized().then((m) => (maximized = m));
		syncMaximized();
		const unlisten = ipc.onWindowResized(syncMaximized);
		return () => {
			store.dispose();
			window.clearTimeout(outcomeTimer);
			void unlisten.then((stop) => stop());
		};
	});

	$effect(() => {
		const id = store.current?.id;
		if (id) void runner.loadRuns(id);
	});

	$effect(() => {
		runner.showFlow(flow?.id ?? null);
	});

	$effect(() => {
		if (mode !== 'narrow') drawerOpen = false;
	});

	function ask(kind: DialogKind, target: DialogTarget = {}) {
		dialog = { kind, ...target };
		dialogOpen = true;
	}

	function findClient(idpId?: string, clientId?: string): Client | undefined {
		return store.current?.idps.find((i) => i.id === idpId)?.clients.find((c) => c.id === clientId);
	}

	/** REQ-UI-020: opening a history run selects its flow when it still exists. */
	function openRun(runId: string) {
		const r = runner.runs.find((x) => x.id === runId);
		if (!r) return;
		if (findClient(r.idpId, r.clientId)?.flows.some((f) => f.id === r.flowId)) {
			store.selectFlow(r.idpId, r.clientId, r.flowId);
			runner.showFlow(r.flowId);
			editorTab = 'flow';
			drawerOpen = false;
		}
		runner.select(runId);
	}

	async function confirmDialog(value: string) {
		const d = dialog;
		if (!d) return;
		if (d.kind === 'saveAs') await store.saveAs(value);
		else if (d.kind === 'rename') await store.rename(value);
		else if (d.kind === 'delete') await store.deleteCurrent();
		else if (d.kind === 'deleteIdp' && d.idpId) await store.deleteIdp(d.idpId);
		else if (d.kind === 'deleteClient' && d.idpId && d.clientId) {
			await store.deleteClient(d.idpId, d.clientId);
		} else if (d.kind === 'deleteFlow' && d.idpId && d.clientId && d.flowId) {
			await store.deleteFlow(d.idpId, d.clientId, d.flowId);
		} else if (d.kind === 'renameIdp') {
			const live = store.current?.idps.find((i) => i.id === d.idpId);
			if (live) live.name = value;
		} else if (d.kind === 'renameClient') {
			const live = findClient(d.idpId, d.clientId);
			if (live) live.name = value;
		} else if (d.kind === 'renameFlow') {
			const live = findClient(d.idpId, d.clientId)?.flows.find((f) => f.id === d.flowId);
			if (live) live.name = value;
		}
	}

	const DIALOGS: Record<DialogKind, { title: string; confirm: string }> = {
		saveAs: { title: 'Save as workspace', confirm: 'Save' },
		rename: { title: 'Rename workspace', confirm: 'Rename' },
		delete: { title: 'Delete workspace', confirm: 'Delete' },
		deleteIdp: { title: 'Delete IdP', confirm: 'Delete' },
		deleteClient: { title: 'Delete client', confirm: 'Delete' },
		deleteFlow: { title: 'Delete flow', confirm: 'Delete' },
		renameIdp: { title: 'Rename IdP', confirm: 'Rename' },
		renameClient: { title: 'Rename client', confirm: 'Rename' },
		renameFlow: { title: 'Rename flow', confirm: 'Rename' }
	};

	const dialogInitialValue = $derived.by(() => {
		if (dialog?.kind === 'rename') return store.current?.name ?? '';
		if (dialog?.kind === 'renameIdp') {
			return store.current?.idps.find((i) => i.id === dialog?.idpId)?.name ?? '';
		}
		if (dialog?.kind === 'renameClient') {
			return findClient(dialog.idpId, dialog.clientId)?.name ?? '';
		}
		if (dialog?.kind === 'renameFlow') {
			return (
				findClient(dialog.idpId, dialog.clientId)?.flows.find((f) => f.id === dialog?.flowId)
					?.name ?? ''
			);
		}
		return '';
	});

	async function run(
		target: { idp: Idp | null; client: Client | null; flow: Flow | null } = { idp, client, flow }
	) {
		if (!store.current || !target.idp || !target.client || !target.flow) return;
		const finished = await runner.start(store.current.id, target.idp, target.client, target.flow);
		if (!finished) return;
		const tab = tabForRun(finished);
		if (tab && finished.flowId === runner.flowId) resultsTab = tab;
		outcome =
			finished.status === 'success' ? 'success' : finished.status === 'error' ? 'error' : null;
		window.clearTimeout(outcomeTimer);
		outcomeTimer = window.setTimeout(() => (outcome = null), OUTCOME_MS);
	}

	function onDiscoveryResult(result: DiscoveryOutcome) {
		runner.discoveryError = result.error;
		if (result.error) resultsTab = 'errors';
	}

	function useRefreshToken(refreshToken: string) {
		if (!idp || !client) return;
		const created = store.addFlow(idp.id, client.id, 'refresh_token');
		const live = client.flows.find((f) => f.id === created?.id);
		if (!created || !live) return;
		live.params.refreshToken = refreshToken;
		store.selectFlow(idp.id, client.id, live.id);
		editorTab = 'flow';
	}

	function clearSession() {
		ipc.browserClearSession().catch((e: unknown) => (store.toast = errorMessage(e)));
	}

	function selectIdp(idpId: string) {
		store.selectIdp(idpId);
		editorTab = 'idp';
		drawerOpen = false;
	}

	function selectClient(idpId: string, clientId: string) {
		store.selectClient(idpId, clientId);
		editorTab = 'client';
		drawerOpen = false;
	}

	function selectFlow(idpId: string, clientId: string, flowId: string) {
		store.selectFlow(idpId, clientId, flowId);
		editorTab = 'flow';
		drawerOpen = false;
	}

	/** REQ-UI-017: no confirmation; the new client is selected and its form opens. */
	function addClient(idpId: string) {
		if (!store.addClient(idpId)) return;
		editorTab = 'client';
		drawerOpen = false;
	}

	/** REQ-UI-017: the flow type is the only input, so it is picked from a menu instead of a dialog. */
	function addFlowMenu(i: SidebarIdp, c: SidebarClient): MenuEntry[] {
		return FLOW_TYPES.map((type) => ({
			label: FLOW_TYPE_LABELS[type],
			onselect: () => {
				if (!store.addFlow(i.id, c.id, type)) return;
				editorTab = 'flow';
				drawerOpen = false;
			}
		}));
	}

	/** REQ-UI-011 */
	function idpMenu(i: SidebarIdp): MenuEntry[] {
		return [
			{ label: 'Add client', onselect: () => addClient(i.id) },
			{ label: 'Duplicate', onselect: () => void store.duplicateIdp(i.id) },
			{ label: 'Rename…', onselect: () => ask('renameIdp', { idpId: i.id }) },
			'separator',
			{ label: 'Delete…', danger: true, onselect: () => ask('deleteIdp', { idpId: i.id }) }
		];
	}

	function clientMenu(i: SidebarIdp, c: SidebarClient): MenuEntry[] {
		const target = { idpId: i.id, clientId: c.id };
		return [
			{ label: 'Duplicate', onselect: () => void store.duplicateClient(i.id, c.id) },
			{ label: 'Rename…', onselect: () => ask('renameClient', target) },
			'separator',
			{ label: 'Delete…', danger: true, onselect: () => ask('deleteClient', target) }
		];
	}

	function flowMenu(i: SidebarIdp, c: SidebarClient, f: SidebarFlow): MenuEntry[] {
		const target = { idpId: i.id, clientId: c.id, flowId: f.id };
		return [
			{
				label: 'Run',
				disabled: runner.running,
				onselect: () => {
					store.selectFlow(i.id, c.id, f.id);
					editorTab = 'flow';
					void run({
						idp: store.selectedIdp,
						client: store.selectedClient,
						flow: store.selectedFlow
					});
				}
			},
			{ label: 'Duplicate', onselect: () => void store.duplicateFlow(i.id, c.id, f.id) },
			{ label: 'Rename…', onselect: () => ask('renameFlow', target) },
			'separator',
			{ label: 'Delete…', danger: true, onselect: () => ask('deleteFlow', target) }
		];
	}

	function workspaceMenu(): MenuEntry[] {
		return [
			{ label: 'Save as workspace…', disabled: !isScratchpad, onselect: () => ask('saveAs') },
			{ label: 'Rename…', disabled: isScratchpad, onselect: () => ask('rename') },
			{ label: 'Export…', onselect: () => void store.exportCurrent() },
			{ label: 'Import…', onselect: () => store.importWorkspace() },
			'separator',
			{
				label: isScratchpad ? 'Clear scratchpad…' : 'Delete workspace…',
				danger: true,
				onselect: () => ask('delete')
			}
		];
	}
</script>

{#snippet sidebar()}
	<Sidebar
		idps={store.current?.idps ?? []}
		selectedIdpId={store.selection.idpId ?? undefined}
		selectedClientId={store.selection.clientId ?? undefined}
		selectedFlowId={store.selection.flowId ?? undefined}
		onselectidp={selectIdp}
		onselectclient={selectClient}
		onselectflow={selectFlow}
		onaddidp={() => store.addIdp()}
		onaddclient={addClient}
		canAddIdp={!!store.current}
		{idpMenu}
		{clientMenu}
		{flowMenu}
		{addFlowMenu}
	/>
{/snippet}

{#snippet editor()}
	{#if idp}
		<FlowEditor title={editorTitle}>
			<Tabs label="Editor" padded tabs={editorTabs} bind:active={editorTab}>
				{#snippet panel(id)}
					{#if id === 'flow' && flow && client}
						<FlowForm
							{idp}
							{client}
							{flow}
							{store}
							{ipc}
							runs={clientRuns}
							running={runner.running}
							deviceCode={runner.deviceCode}
							onrun={() => void run()}
						/>
					{:else if id === 'client' && client}
						<ClientForm {client} {store} />
			{#snippet actions()}
				{#if activeEditorTab === 'flow' && flow}
					<RunControls
						running={runner.running}
						onrun={() => void run()}
						oncancel={() => runner.cancel()}
					/>
				{/if}
			{/snippet}
					{:else}
						<IdpForm {idp} {ipc} {onDiscoveryResult} onclearsession={clearSession} />
					{/if}
				{/snippet}
			</Tabs>
		</FlowEditor>
	{:else}
		<FlowEditor />
	{/if}
{/snippet}

{#snippet results()}
	<ResultsPanel bind:active={resultsTab}>
		{#snippet tokens()}
			<TokensPanel
				run={runner.shown}
				userinfo={runner.userinfo}
				onuserinfo={canUserInfo ? () => void runner.fetchUserInfo() : undefined}
				onuserefresh={useRefreshToken}
			/>
		{/snippet}
		{#snippet errors()}
			<ErrorsPanel
				error={runner.shown?.error ?? runner.discoveryError}
				validations={runner.shown?.validations}
				openLink={(url) => void ipc.openUrl(url)}
			/>
		{/snippet}
		{#snippet timeline()}
			<TimelinePanel
				{ipc}
				run={runner.shown}
				runs={idpRuns}
				onselectrun={openRun}
				ondeleterun={(id) => void runner.remove(workspaceId, id)}
				appVersion={pkg.version}
			/>
		{/snippet}
	</ResultsPanel>
{/snippet}

<div bind:clientWidth={width} class="flex h-screen flex-col bg-surface">
	<TitleBar
		workspaces={store.workspaces}
		{workspaceId}
		onworkspacechange={(id) => void store.open(id)}
		{workspaceMenu}
		showDrawerToggle={mode === 'narrow'}
		{drawerOpen}
		ontoggledrawer={() => (drawerOpen = !drawerOpen)}
		{maximized}
		onminimize={() => void ipc.windowMinimize()}
		ontogglemaximize={() => void ipc.windowToggleMaximize()}
		onclose={() => void ipc.windowClose()}
		{runState}
	/>

	{#if store.banner}
		<div role="alert" class="shrink-0 border-b border-border bg-surface-sunken px-3 py-1.5 text-sm">
			<span class="font-medium text-danger">{store.banner}</span>
		</div>
	{/if}
	{#if store.toast}
		<div
			role="status"
			class="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-sunken px-3 py-1.5 text-sm"
		>
			<span>{store.toast}</span>
			<Button variant="ghost" onclick={() => (store.toast = null)}>Dismiss</Button>
		</div>
	{/if}

	<div class="min-h-0 flex-1">
		{#if mode === 'wide'}
			<SplitPane size={264} min={220} max={400} label="Resize sidebar">
				{#snippet start()}
					{@render sidebar()}
				{/snippet}
				{#snippet end()}
					<SplitPane fixed="end" size={700} min={360} max={960} label="Resize results">
						{#snippet start()}
							{@render editor()}
						{/snippet}
						{#snippet end()}
							{@render results()}
						{/snippet}
					</SplitPane>
				{/snippet}
			</SplitPane>
		{:else if mode === 'medium'}
			<SplitPane size={240} min={200} max={320} label="Resize sidebar">
				{#snippet start()}
					{@render sidebar()}
				{/snippet}
				{#snippet end()}
					<SplitPane
						orientation="vertical"
						fixed="end"
						size={340}
						min={160}
						max={640}
						label="Resize results"
					>
						{#snippet start()}
							{@render editor()}
						{/snippet}
						{#snippet end()}
							{@render results()}
						{/snippet}
					</SplitPane>
				{/snippet}
			</SplitPane>
		{:else}
			<Drawer bind:open={drawerOpen}>
				{@render sidebar()}
			</Drawer>
			<SplitPane
				orientation="vertical"
				fixed="end"
				size={300}
				min={140}
				max={560}
				label="Resize results"
			>
				{#snippet start()}
					{@render editor()}
				{/snippet}
				{#snippet end()}
					{@render results()}
				{/snippet}
			</SplitPane>
		{/if}
	</div>
</div>

<ContextMenuHost />

{#if dialog}
	{@const spec = DIALOGS[dialog.kind]}
	<Dialog
		bind:open={dialogOpen}
		title={spec.title}
		confirmLabel={spec.confirm}
		danger={spec.confirm === 'Delete'}
		inputLabel={dialog.kind === 'saveAs' ||
		dialog.kind === 'rename' ||
		dialog.kind === 'renameIdp' ||
		dialog.kind === 'renameClient' ||
		dialog.kind === 'renameFlow'
			? 'Name'
			: undefined}
		initialValue={dialogInitialValue}
		message={dialog.kind === 'delete'
			? isScratchpad
				? 'Remove every IdP, client, flow, run and stored secret from the scratchpad?'
				: 'Delete this workspace with its runs and stored secrets?'
			: dialog.kind === 'deleteIdp'
				? 'Delete this IdP, its clients, flows and stored secrets?'
				: dialog.kind === 'deleteClient'
					? 'Delete this client, its flows and stored secrets?'
					: dialog.kind === 'deleteFlow'
						? 'Delete this flow and its stored password?'
						: undefined}
		onconfirm={(value) => void confirmDialog(value)}
	/>
{/if}
