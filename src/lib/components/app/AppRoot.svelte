<script lang="ts">
	import { onMount } from 'svelte';
	import pkg from '../../../../package.json';
	import FlowForm from '$lib/components/editors/FlowForm.svelte';
	import IdpForm, { type DiscoveryOutcome } from '$lib/components/editors/IdpForm.svelte';
	import ErrorsPanel from '$lib/components/results/ErrorsPanel.svelte';
	import TokensPanel from '$lib/components/results/TokensPanel.svelte';
	import FlowEditor from '$lib/components/shell/FlowEditor.svelte';
	import ResultsPanel from '$lib/components/shell/ResultsPanel.svelte';
	import Sidebar from '$lib/components/shell/Sidebar.svelte';
	import TimelinePanel from '$lib/components/timeline/TimelinePanel.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import SplitPane from '$lib/components/ui/SplitPane.svelte';
	import Tabs from '$lib/components/ui/Tabs.svelte';
	import ThemeToggle from '$lib/components/ui/ThemeToggle.svelte';
	import type { IpcApi } from '$lib/ipc/types';
	import { FLOW_TYPE_LABELS, SCRATCHPAD_ID, type FlowType } from '$lib/model/schema';
	import { callUserInfo, executeRun } from '$lib/run/engine';
	import { tabForRun } from '$lib/run/tabs';
	import { errorMessage } from '$lib/state/secrets';
	import { RunnerStore } from '$lib/state/runner.svelte';
	import { WorkspaceStore } from '$lib/state/workspace.svelte';

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

	type DialogKind = 'saveAs' | 'rename' | 'delete' | 'addFlow' | 'deleteIdp' | 'deleteFlow';
	let dialog = $state<{ kind: DialogKind; idpId?: string; flowId?: string } | null>(null);
	let dialogOpen = $state(false);
	let resultsTab = $state('tokens');
	let editorTab = $state('flow');

	const workspaceId = $derived(store.current?.id ?? SCRATCHPAD_ID);
	const idp = $derived(store.selectedIdp);
	const flow = $derived(store.selectedFlow);
	const idpRuns = $derived(idp ? runner.runs.filter((r) => r.idpId === idp.id) : runner.runs);
	const canUserInfo = $derived(
		(runner.shown?.idpSnapshot.endpoints.userinfo ?? '') !== '' &&
			runner.shown?.flowSnapshot.params.scope.split(/\s+/).includes('openid') === true
	);
	const isScratchpad = $derived(workspaceId === SCRATCHPAD_ID);
	const flowTypeOptions = Object.entries(FLOW_TYPE_LABELS).map(([value, label]) => ({
		value,
		label
	}));

	onMount(() => {
		void store.init();
		return () => store.dispose();
	});

	$effect(() => {
		const id = store.current?.id;
		if (id) void runner.loadRuns(id);
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
		}
	}

	const DIALOGS: Record<DialogKind, { title: string; confirm: string }> = {
		saveAs: { title: 'Save as workspace', confirm: 'Save' },
		rename: { title: 'Rename workspace', confirm: 'Rename' },
		delete: { title: 'Delete workspace', confirm: 'Delete' },
		addFlow: { title: 'Add flow', confirm: 'Add' },
		deleteIdp: { title: 'Delete IdP', confirm: 'Delete' },
		deleteFlow: { title: 'Delete flow', confirm: 'Delete' }
	};

	async function run() {
		if (!store.current || !idp || !flow) return;
		const finished = await runner.start(store.current.id, idp, flow);
		const tab = tabForRun(finished);
		if (tab) resultsTab = tab;
	}

	function onDiscoveryResult(outcome: DiscoveryOutcome) {
		runner.discoveryError = outcome.error;
		if (outcome.error) resultsTab = 'errors';
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
	}

	function selectFlow(idpId: string, flowId: string) {
		store.selectFlow(idpId, flowId);
		editorTab = 'flow';
	}
</script>

<div class="flex h-screen flex-col">
	<header
		class="flex shrink-0 items-center justify-between border-b border-border bg-surface-raised px-3 py-1.5"
	>
		<span class="text-sm font-semibold">OIDC Tester</span>
		<ThemeToggle />
	</header>

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
		<SplitPane size={280} min={200} max={480} label="Resize sidebar">
			{#snippet start()}
				<Sidebar
					workspaces={store.workspaces}
					{workspaceId}
					idps={store.current?.idps ?? []}
					selectedIdpId={store.selection.idpId ?? undefined}
					selectedFlowId={store.selection.flowId ?? undefined}
					onworkspacechange={(id) => void store.open(id)}
					onselectidp={selectIdp}
					onselectflow={selectFlow}
				>
					{#snippet actions()}
						<Button onclick={() => ask('saveAs')} disabled={!isScratchpad}
							>Save as workspace…</Button
						>
						<Button onclick={() => ask('rename')} disabled={isScratchpad}>Rename</Button>
						<Button onclick={() => ask('delete')}>{isScratchpad ? 'Clear' : 'Delete'}</Button>
						<Button onclick={() => void store.exportCurrent()}>Export</Button>
						<Button onclick={() => void store.importWorkspace()}>Import</Button>
						<Button variant="primary" disabled={!store.current} onclick={() => store.addIdp()}
							>Add IdP</Button
						>
					{/snippet}
					{#snippet idpActions(i)}
						<Button
							variant="ghost"
							aria-label="Add flow to {i.name}"
							onclick={() => ask('addFlow', { idpId: i.id })}>+</Button
						>
						<Button
							variant="ghost"
							aria-label="Duplicate IdP {i.name}"
							onclick={() => void store.duplicateIdp(i.id)}>⧉</Button
						>
						<Button
							variant="ghost"
							aria-label="Delete IdP {i.name}"
							onclick={() => ask('deleteIdp', { idpId: i.id })}>✕</Button
						>
					{/snippet}
					{#snippet flowActions(i, f)}
						<Button
							variant="ghost"
							aria-label="Duplicate flow {f.name}"
							onclick={() => void store.duplicateFlow(i.id, f.id)}>⧉</Button
						>
						<Button
							variant="ghost"
							aria-label="Delete flow {f.name}"
							onclick={() => ask('deleteFlow', { idpId: i.id, flowId: f.id })}>✕</Button
						>
					{/snippet}
				</Sidebar>
			{/snippet}
			{#snippet end()}
				<SplitPane fixed="end" size={480} min={300} max={900} label="Resize results">
					{#snippet start()}
						{#if idp}
							<FlowEditor title={editorTab === 'idp' || !flow ? idp.name : flow.name}>
								<Tabs
									label="Editor"
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
											<IdpForm
												{idp}
												{store}
												{ipc}
												{onDiscoveryResult}
												onclearsession={clearSession}
											/>
										{/if}
									{/snippet}
								</Tabs>
							</FlowEditor>
						{:else}
							<FlowEditor />
						{/if}
					{/snippet}
					{#snippet end()}
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
				</SplitPane>
			{/snippet}
		</SplitPane>
	</div>
</div>

{#if dialog}
	{@const spec = DIALOGS[dialog.kind]}
	<Dialog
		bind:open={dialogOpen}
		title={spec.title}
		confirmLabel={spec.confirm}
		danger={spec.confirm === 'Delete'}
		inputLabel={dialog.kind === 'saveAs' || dialog.kind === 'rename'
			? 'Name'
			: dialog.kind === 'addFlow'
				? 'Flow type'
				: undefined}
		options={dialog.kind === 'addFlow' ? flowTypeOptions : undefined}
		initialValue={dialog.kind === 'rename' ? (store.current?.name ?? '') : ''}
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
