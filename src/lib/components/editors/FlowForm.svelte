<script lang="ts">
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import KeyValueEditor from '#lib/components/ui/KeyValueEditor.svelte';
	import SecretField from '#lib/components/ui/SecretField.svelte';
	import SelectField from '#lib/components/ui/SelectField.svelte';
	import TextField from '#lib/components/ui/TextField.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';
	import FormSection from '#lib/components/ui/FormSection.svelte';
	import { menu } from '#lib/components/ui/contextMenu.js';
	import { contextMenu } from '#lib/state/contextMenu.svelte.js';
	import type { IpcApi } from '#lib/ipc/types.js';
	import { FLOW_TYPE_LABELS, type Client, type Flow, type Idp } from '#lib/model/schema.js';
	import type { Run } from '#lib/model/run.js';
	import {
		RESPONSE_MODE_OPTIONS,
		usesPkce,
		isFrontChannel,
		previewAuthorizeUrl,
		type AuthorizeValues
	} from '#lib/oauth/authorize.js';
	import type { DeviceUserCode } from '#lib/oauth/device.js';
	import { discoverySuggestions, unsupportedWarnings } from '#lib/oauth/discovery.js';
	import { generateVerifier } from '#lib/oauth/pkce.js';
	import { redirectUriWarning } from '#lib/oauth/redirect.js';
	import type { WorkspaceStore } from '#lib/state/workspace.svelte.js';
	import { visibleFields } from './fieldMatrix';

	interface Props {
		idp: Idp;
		client: Client;
		flow: Flow;
		store: WorkspaceStore;
		/** Past runs of this client; those with a refresh token feed "Use from run…". */
		runs: Run[];
		running: boolean;
		deviceCode: DeviceUserCode | null;
		/** Used to open the device verification URI in the system browser. */
		ipc: IpcApi;
		onrun: () => void;
	}

	let {
		idp,
		client,
		flow = $bindable(),
		store,
		runs,
		running,
		deviceCode,
		ipc,
		onrun
	}: Props = $props();

	const uid = $props.id();
	const show = $derived(visibleFields(flow.type));
	const suggestions = $derived(idp.discovery ? discoverySuggestions(idp.discovery) : null);
	const warnings = $derived(unsupportedWarnings(flow, idp.discovery));
	const redirectWarning = $derived(
		show.redirectUri ? redirectUriWarning(flow.params.redirectUri) : null
	);
	const refreshRuns = $derived(runs.filter((r) => r.tokens?.refresh_token));
	const frontChannel = $derived(isFrontChannel(flow));

	// Preview: auto-generated state/nonce/verifier stay stable across edits; "Regenerate" replaces the verifier.
	let preview = $state<{ url: string | null; message: string | null }>({
		url: null,
		message: null
	});
	let verifier = $state<string | null>(null);
	let regenerated = $state<string | null>(null);
	let kept: Partial<AuthorizeValues> | undefined;
	let keptFlowId = '';
	let copied = $state(false);

	const hasAdvanced = $derived(
		show.prompt ||
			show.loginHint ||
			show.maxAge ||
			show.acrValues ||
			show.uiLocales ||
			show.claims ||
			show.cleanSession
	);
	const advancedSet = $derived(
		[
			show.prompt && flow.params.prompt,
			show.loginHint && flow.params.loginHint,
			show.maxAge && flow.params.maxAge,
			show.acrValues && flow.params.acrValues,
			show.uiLocales && flow.params.uiLocales,
			show.claims && flow.params.claims
		].filter((value) => typeof value === 'string' && value.trim() !== '').length +
			(show.cleanSession && flow.cleanSession ? 1 : 0)
	);

	$effect(() => {
		const flowSnapshot = $state.snapshot(flow);
		const idpSnapshot = $state.snapshot(idp);
		const clientSnapshot = $state.snapshot(client);
		const override = regenerated;
		if (!isFrontChannel(flowSnapshot)) {
			preview = { url: null, message: null };
			verifier = null;
			return;
		}
		if (keptFlowId !== flowSnapshot.id) {
			kept = undefined;
			keptFlowId = flowSnapshot.id;
		}
		if (override !== null) kept = { ...kept, codeVerifier: override };
		let stale = false;
		void previewAuthorizeUrl(idpSnapshot, clientSnapshot, flowSnapshot, kept).then((result) => {
			if (stale) return;
			kept = result.values;
			verifier = result.values.codeVerifier;
			preview = result.ok
				? { url: result.url, message: null }
				: { url: null, message: result.message };
		});
		return () => {
			stale = true;
		};
	});

	function regenerate() {
		regenerated = generateVerifier();
	}

	async function copyPreview() {
		if (preview.url === null) return;
		await navigator.clipboard.writeText(preview.url);
		copied = true;
	}

	let now = $state(Date.now());
	$effect(() => {
		if (!deviceCode) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});
	const remainingSeconds = $derived(
		deviceCode ? Math.max(0, Math.ceil((deviceCode.expiresAt - now) / 1000)) : 0
	);

	function useRun(event: Event & { currentTarget: HTMLSelectElement }) {
		const run = refreshRuns.find((r) => r.id === event.currentTarget.value);
		if (run?.tokens?.refresh_token) flow.params.refreshToken = run.tokens.refresh_token;
		event.currentTarget.value = '';
	}

	const runOptions = $derived([
		{ value: '', label: 'Use from run…' },
		...refreshRuns.map((r) => ({
			value: r.id,
			label: `${new Date(r.startedAt).toLocaleString()} — ${r.flowSnapshot.name}`
		}))
	]);
</script>

{#snippet datalist(id: string, values: string[] | undefined)}
	{#if values?.length}
		<datalist {id}>
			{#each values as value (value)}
				<option {value}></option>
			{/each}
		</datalist>
	{/if}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form
	class="@container flex max-w-[44rem] flex-col"
	aria-label="Flow settings"
	onsubmit={(event) => event.preventDefault()}
	onkeydown={(event) => {
		// No submit button lives in the form (Run is in the title row), so implicit submission is explicit.
		if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
		event.preventDefault();
		if (!running) onrun();
	}}
>
	<div class="flex flex-col gap-3 pb-3">
		{#if flow.name !== FLOW_TYPE_LABELS[flow.type]}
			<!-- The type is otherwise only visible as the default name; show it once the flow is renamed. -->
			<div class="flex flex-wrap items-center gap-2">
				<Badge>{FLOW_TYPE_LABELS[flow.type]}</Badge>
			</div>
		{/if}

		{#if deviceCode}
			<section class="panel p-3" aria-label="Device code">
				<p class="field-label">Enter this code on the verification page</p>
				<p class="font-mono text-2xl font-semibold" data-testid="user-code">
					{deviceCode.userCode}
				</p>
				<p class="mt-1 text-sm">
					<button
						type="button"
						class="cursor-pointer text-fg underline"
						onclick={() =>
							void ipc.openUrl(deviceCode.verificationUriComplete ?? deviceCode.verificationUri)}
					>
						{deviceCode.verificationUri}
					</button>
				</p>
				<p class="mt-1 text-xs text-fg-muted">Expires in {remainingSeconds}s</p>
			</section>
		{/if}

		{#if warnings.length > 0}
			<ul class="flex flex-col gap-1" aria-label="Discovery warnings">
				{#each warnings as warning (warning)}
					<li class="text-sm text-warning">{warning}</li>
				{/each}
			</ul>
		{/if}
	</div>

	<FormSection id="flow.request" title="Request">
		<TextField label="Name" bind:value={flow.name} />
		{#if show.responseType || show.responseMode}
			<div class="field-grid">
				{#if show.responseType}
					<SelectField
						label="Response type"
						bind:value={flow.params.responseType}
						options={(flow.type === 'implicit'
							? ['token', 'id_token', 'id_token token']
							: ['code id_token', 'code token', 'code id_token token']
						).map((value) => ({ value }))}
					/>
				{/if}
				{#if show.responseMode}
					<SelectField
						label="Response mode"
						bind:value={flow.params.responseMode}
						options={RESPONSE_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
					/>
				{/if}
			</div>
		{/if}
		{#if show.usePkce}
			<Toggle label="Use PKCE" bind:checked={flow.params.usePkce} />
		{/if}
		{#if show.redirectUri}
			<div class="flex flex-col gap-1">
				<TextField
					label="Redirect URI"
					mono
					bind:value={flow.params.redirectUri}
					hint="Does not have to resolve; the popup captures the navigation to it."
				/>
				{#if redirectWarning}
					<p class="text-xs text-warning" role="alert">{redirectWarning}</p>
				{/if}
			</div>
		{/if}
		{#if show.scope}
			{@render datalist(`${uid}-scopes`, suggestions?.scopes)}
			<TextField label="Scope" mono list="{uid}-scopes" bind:value={flow.params.scope} />
		{/if}
		{#if show.state}
			<div class="grid grid-cols-[10rem_1fr] items-end gap-2">
				<SelectField
					label="State"
					bind:value={flow.params.state.mode}
					options={[
						{ value: 'auto', label: 'auto' },
						{ value: 'fixed', label: 'fixed' }
					]}
				/>
				<TextField
					label="State value"
					mono
					disabled={flow.params.state.mode === 'auto'}
					bind:value={flow.params.state.value}
				/>
			</div>
		{/if}
		{#if show.nonce}
			<div class="grid grid-cols-[10rem_1fr] items-end gap-2">
				<SelectField
					label="Nonce"
					bind:value={flow.params.nonce.mode}
					options={[
						{ value: 'auto', label: 'auto' },
						{ value: 'fixed', label: 'fixed' },
						{ value: 'off', label: 'off' }
					]}
				/>
				<TextField
					label="Nonce value"
					mono
					disabled={flow.params.nonce.mode !== 'fixed'}
					bind:value={flow.params.nonce.value}
				/>
			</div>
		{/if}
		{#if show.username || show.password}
			<div class="field-grid">
				{#if show.username}
					<TextField label="Username" bind:value={flow.params.username} autocomplete="off" />
				{/if}
				{#if show.password}
					<SecretField
						label="Password"
						hasSecret={flow.params.hasPassword}
						onsave={(value) => void store.setFlowPassword(flow, value)}
						onclear={() => void store.clearFlowPassword(flow)}
					/>
				{/if}
			</div>
		{/if}
		{#if show.refreshToken}
			<div class="field-grid">
				<TextField label="Refresh token" mono bind:value={flow.params.refreshToken} />
				<SelectField
					label="Use from run"
					value=""
					options={runOptions}
					disabled={refreshRuns.length === 0}
					onchange={useRun}
				/>
			</div>
		{/if}
		{#if show.pkceMethod}
			<SelectField
				label="PKCE method"
				bind:value={flow.params.pkceMethod}
				options={[{ value: 'S256' }, { value: 'plain' }]}
			/>
		{/if}
		{#if usesPkce(flow) && verifier !== null}
			<div class="flex items-end gap-2">
				<div class="flex-1">
					<TextField label="Code verifier" mono readonly value={verifier} />
				</div>
				<Button onclick={regenerate}>Regenerate</Button>
			</div>
		{/if}
		{#if show.audience || show.resource}
			<div class="field-grid">
				{#if show.audience}
					<TextField label="Audience" bind:value={flow.params.audience} />
				{/if}
				{#if show.resource}
					<TextField label="Resource" bind:value={flow.params.resource} />
				{/if}
			</div>
		{/if}
	</FormSection>

	{#if hasAdvanced}
		<FormSection id="flow.advanced" title="Advanced" defaultOpen={false}>
			{#snippet summary(open)}
				{#if !open && advancedSet > 0}
					<span class="text-xs text-fg-muted">{advancedSet} set</span>
				{/if}
			{/snippet}
			{#if show.prompt || show.maxAge}
				<div class="field-grid">
					{#if show.prompt}
						<TextField label="Prompt" bind:value={flow.params.prompt} />
					{/if}
					{#if show.maxAge}
						<TextField label="Max age" inputmode="numeric" bind:value={flow.params.maxAge} />
					{/if}
				</div>
			{/if}
			{#if show.loginHint || show.uiLocales}
				<div class="field-grid">
					{#if show.loginHint}
						<TextField label="Login hint" bind:value={flow.params.loginHint} />
					{/if}
					{#if show.uiLocales}
						<TextField label="UI locales" bind:value={flow.params.uiLocales} />
					{/if}
				</div>
			{/if}
			{#if show.acrValues}
				<TextField label="ACR values" bind:value={flow.params.acrValues} />
			{/if}
			{#if show.claims}
				<TextField label="Claims (JSON)" mono bind:value={flow.params.claims} />
			{/if}
			{#if show.cleanSession}
				<Toggle label="Clean browser session" bind:checked={flow.cleanSession} />
			{/if}
		</FormSection>
	{/if}

	{#if show.extraAuthParams || show.extraTokenParams || show.headers}
		<FormSection id="flow.extras" title="Extra parameters & headers">
			{#if show.extraAuthParams}
				<KeyValueEditor
					label={flow.type === 'device_code'
						? 'Extra device authorization params'
						: 'Extra authorize params'}
					addLabel="Add authorize param"
					bind:rows={flow.params.extraAuthParams}
				/>
			{/if}
			{#if show.extraTokenParams}
				<KeyValueEditor
					label="Extra token params"
					addLabel="Add token param"
					bind:rows={flow.params.extraTokenParams}
				/>
			{/if}
			{#if show.headers}
				<KeyValueEditor
					label="Flow headers"
					addLabel="Add header"
					namePlaceholder="Header"
					bind:rows={flow.headers}
				/>
			{/if}
		</FormSection>
	{/if}

	{#if frontChannel}
		<div
			class="sticky -bottom-4 z-10 -mx-4 mt-2 -mb-4 flex flex-wrap items-center gap-2 border-t border-border bg-surface-raised px-4 py-2.5"
		>
			<div class="flex min-w-0 flex-1 items-center gap-2">
				<button
					type="button"
					class="btn btn-icon shrink-0 btn-ghost"
					aria-label={copied ? 'Copied' : 'Copy'}
					disabled={preview.url === null}
					onclick={copyPreview}
				>
					{#if copied}
						<Check size={16} aria-hidden="true" />
					{:else}
						<Copy size={16} aria-hidden="true" />
					{/if}
				</button>
				{#if preview.url !== null}
					<p
						data-testid="authorize-preview"
						title={preview.url}
						class="min-w-0 flex-1 truncate font-mono text-xs"
						{@attach menu(
							() => [{ label: 'Copy', onselect: () => contextMenu.copy(preview.url ?? '') }],
							'Authorize URL actions'
						)}
					>
						{preview.url}
					</p>
				{:else if preview.message}
					<p class="min-w-0 flex-1 text-xs text-danger">{preview.message}</p>
				{:else}
					<div class="flex-1"></div>
				{/if}
			</div>
		</div>
	{/if}
</form>
