<script lang="ts">
	import { onMount } from 'svelte';
	import pkg from '../../../../package.json';
	import FlowForm from '$lib/components/editors/FlowForm.svelte';
	import IdpForm, { type DiscoveryOutcome } from '$lib/components/editors/IdpForm.svelte';
	import ErrorsPanel from '$lib/components/results/ErrorsPanel.svelte';
	import TokensPanel from '$lib/components/results/TokensPanel.svelte';
	import Drawer from '$lib/components/shell/Drawer.svelte';
	import FlowEditor from '$lib/components/shell/FlowEditor.svelte';
	import ResultsPanel from '$lib/components/shell/ResultsPanel.svelte';
	import Sidebar from '$lib/components/shell/Sidebar.svelte';
	import TitleBar from '$lib/components/shell/TitleBar.svelte';
	import type { SidebarFlow, SidebarIdp } from '$lib/components/shell/types';
	import TimelinePanel from '$lib/components/timeline/TimelinePanel.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ContextMenuHost from '$lib/components/ui/ContextMenuHost.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import type { MenuEntry } from '$lib/components/ui/menu';
	import SplitPane from '$lib/components/ui/SplitPane.svelte';
	import Tabs from '$lib/components/ui/Tabs.svelte';
	import type { IpcApi } from '$lib/ipc/types';
	import {
		FLOW_TYPE_LABELS,
		SCRATCHPAD_ID,
		type Flow,
		type FlowType,
		type Idp
	} from '$lib/model/schema';
	import { callUserInfo, executeRun } from '$lib/run/engine';
	import { tabForRun } from '$lib/run/tabs';
	import { errorMessage } from '$lib/state/secrets';
	import { RunnerStore } from '$lib/state/runner.svelte';
	import { WorkspaceStore } from '$lib/state/workspace.svelte';
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
		| 'addFlow'
		| 'deleteIdp'
		| 'deleteFlow'
		| 'renameIdp'
		| 'renameFlow';
	let dialog = $state<{ kind: DialogKind; idpId?: string; flowId?: string } | null>(null);
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
	const flow = $derived(store.selectedFlow);
	const idpRuns = $derived(idp ? runner.runs.filter((r) => r.idpId === idp.id) : runner.runs);
	const canUserInfo = $derived(
		(runner.shown?.idpSnapshot.endpoints.userinfo ?? '') !== '' &&
			runner.shown?.flowSnapshot.params.scope.split(/\s+/).includes('openid') === true
	);
	const isScratchpad = $derived(workspaceId === SCRATCHPAD_ID);
	const runState = $derived(runner.running ? 'running' : (outcome ?? 'idle'));
	const flowTypeOptions = Object.entries(FLOW_TYPE_LABELS).map(([value, label]) => ({
		value,
		label
	}));

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
		if (mode !== 'narrow') drawerOpen = false;
	});

	function ask(kind: DialogKind, target: { idpId?: string; flowId?: string } = {}) {
		dialog = { kind, ...target };
		dialogOpen = true;
	}

	async function confirmDialog(value: string) {
		const d = dialog;
		if (!d) return;
		if (d.kind === 'saveAs') await store.saveAs(value);
		else if (d.kind === 'rename') await store.rename(value);
		else if (d.kind === 'delete') await store.deleteCurrent();
		else if (d.kind === 'addFlow' && d.idpId) {
			const created = store.addFlow(d.idpId, value as FlowType);
			if (created) editorTab = 'flow';
		} else if (d.kind === 'deleteIdp' && d.idpId) await store.deleteIdp(d.idpId);
		else if (d.kind === 'deleteFlow' && d.idpId && d.flowId) {
			await store.deleteFlow(d.idpId, d.flowId);
		} else if (d.kind === 'renameIdp') {
			const live = store.current?.idps.find((i) => i.id === d.idpId);
			if (live) live.name = value;
		} else if (d.kind === 'renameFlow') {
			const live = store.current?.idps
				.find((i) => i.id === d.idpId)
				?.flows.find((f) => f.id === d.flowId);
			if (live) live.name = value;
		}
	}

	const DIALOGS: Record<DialogKind, { title: string; confirm: string }> = {
		saveAs: { title: 'Save as workspace', confirm: 'Save' },
		rename: { title: 'Rename workspace', confirm: 'Rename' },
		delete: { title: 'Delete workspace', confirm: 'Delete' },
		addFlow: { title: 'Add flow', confirm: 'Add' },
		deleteIdp: { title: 'Delete IdP', confirm: 'Delete' },
		deleteFlow: { title: 'Delete flow', confirm: 'Delete' },
		renameIdp: { title: 'Rename IdP', confirm: 'Rename' },
		renameFlow: { title: 'Rename flow', confirm: 'Rename' }
	};

	const dialogInitialValue = $derived.by(() => {
		if (dialog?.kind === 'rename') return store.current?.name ?? '';
		if (dialog?.kind === 'renameIdp') {
			return store.current?.idps.find((i) => i.id === dialog?.idpId)?.name ?? '';
		}
		if (dialog?.kind === 'renameFlow') {
			return (
				store.current?.idps
					.find((i) => i.id === dialog?.idpId)
					?.flows.find((f) => f.id === dialog?.flowId)?.name ?? ''
			);
		}
		return '';
	});

	async function run(target: { idp: Idp | null; flow: Flow | null } = { idp, flow }) {
		if (!store.current || !target.idp || !target.flow) return;
		const finished = await runner.start(store.current.id, target.idp, target.flow);
		if (!finished) return;
		const tab = tabForRun(finished);
		if (tab) resultsTab = tab;
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
		if (!idp) return;
		const created = store.addFlow(idp.id, 'refresh_token');
		const live = idp.flows.find((f) => f.id === created?.id);
		if (!created || !live) return;
		live.params.refreshToken = refreshToken;
		store.selectFlow(idp.id, live.id);
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

	function selectFlow(idpId: string, flowId: string) {
		store.selectFlow(idpId, flowId);
		editorTab = 'flow';
		drawerOpen = false;
	}

	/** REQ-UI-011 */
	function idpMenu(i: SidebarIdp): MenuEntry[] {
		return [
			{ label: 'Add flow…', onselect: () => ask('addFlow', { idpId: i.id }) },
			{ label: 'Duplicate', onselect: () => void store.duplicateIdp(i.id) },
			{ label: 'Rename…', onselect: () => ask('renameIdp', { idpId: i.id }) },
			'separator',
			{ label: 'Delete…', danger: true, onselect: () => ask('deleteIdp', { idpId: i.id }) }
		];
	}

	function flowMenu(i: SidebarIdp, f: SidebarFlow): MenuEntry[] {
		return [
			{
				label: 'Run',
				disabled: runner.running,
				onselect: () => {
					store.selectFlow(i.id, f.id);
					editorTab = 'flow';
					void run({ idp: store.selectedIdp, flow: store.selectedFlow });
				}
			},
			{ label: 'Duplicate', onselect: () => void store.duplicateFlow(i.id, f.id) },
			{ label: 'Rename…', onselect: () => ask('renameFlow', { idpId: i.id, flowId: f.id }) },
			'separator',
			{
				label: 'Delete…',
				danger: true,
				onselect: () => ask('deleteFlow', { idpId: i.id, flowId: f.id })
			}
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
		selectedFlowId={store.selection.flowId ?? undefined}
		onselectidp={selectIdp}
		onselectflow={selectFlow}
		onaddidp={() => store.addIdp()}
		canAddIdp={!!store.current}
		{idpMenu}
		{flowMenu}
	/>
{/snippet}

{#snippet editor()}
	{#if idp}
		<FlowEditor title={editorTab === 'idp' || !flow ? idp.name : flow.name}>
			<Tabs
				label="Editor"
				padded
				tabs={flow
					? [
							{ id: 'flow', label: 'Flow' },
							{ id: 'idp', label: 'IdP' }
						]
					: [{ id: 'idp', label: 'IdP' }]}
				bind:active={editorTab}
			>
				{#snippet panel(id)}
					{#if id === 'flow' && flow}
						<FlowForm
							{idp}
							{flow}
							{store}
							{ipc}
							runs={runner.runs}
							running={runner.running}
							deviceCode={runner.deviceCode}
							onrun={() => void run()}
							oncancel={() => runner.cancel()}
						/>
					{:else}
						<IdpForm {idp} {store} {ipc} {onDiscoveryResult} onclearsession={clearSession} />
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
				onselectrun={(id) => runner.select(id)}
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
					<SplitPane fixed="end" size={440} min={320} max={760} label="Resize results">
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
		dialog.kind === 'renameFlow'
			? 'Name'
			: dialog.kind === 'addFlow'
				? 'Flow type'
				: undefined}
		options={dialog.kind === 'addFlow' ? flowTypeOptions : undefined}
		initialValue={dialogInitialValue}
		message={dialog.kind === 'delete'
			? isScratchpad
				? 'Remove every IdP, flow, run and stored secret from the scratchpad?'
				: 'Delete this workspace with its runs and stored secrets?'
			: dialog.kind === 'deleteIdp'
				? 'Delete this IdP, its flows and stored secrets?'
				: dialog.kind === 'deleteFlow'
					? 'Delete this flow and its stored password?'
					: undefined}
		onconfirm={(value) => void confirmDialog(value)}
	/>
{/if}
