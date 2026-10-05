<script lang="ts">
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import FormSection from '#lib/components/ui/FormSection.svelte';
	import KeyValueEditor from '#lib/components/ui/KeyValueEditor.svelte';
	import SecretField from '#lib/components/ui/SecretField.svelte';
	import SelectField from '#lib/components/ui/SelectField.svelte';
	import TextField from '#lib/components/ui/TextField.svelte';
	import TlsInsecureToggle from '#lib/components/ui/TlsInsecureToggle.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';
	import type { HttpExchange, IpcApi } from '#lib/ipc/types.js';
	import type { RunError } from '#lib/model/run.js';
	import type { ClientAuth, Endpoints, Idp } from '#lib/model/schema.js';
	import {
		applyDiscovery,
		discover,
		discoverySuggestions,
		type DiscoveryResult,
		type DiscoverySuccess
	} from '#lib/oauth/discovery.js';
	import { newHttpLog } from '#lib/oauth/transport.js';
	import type { WorkspaceStore } from '#lib/state/workspace.svelte.js';

	export interface DiscoveryOutcome {
		error: RunError | null;
		exchanges: HttpExchange[];
	}

	interface Props {
		idp: Idp;
		store: WorkspaceStore;
		ipc: IpcApi;
		onDiscoveryResult: (result: DiscoveryOutcome) => void;
		onclearsession: () => void;
	}

	let { idp, store, ipc, onDiscoveryResult, onclearsession }: Props = $props();

	const ENDPOINT_LABELS: Record<keyof Endpoints, string> = {
		authorization: 'Authorization endpoint',
		token: 'Token endpoint',
		userinfo: 'UserInfo endpoint',
		jwks: 'JWKS URI',
		deviceAuthorization: 'Device authorization endpoint',
		endSession: 'End session endpoint'
	};
	const ENDPOINT_KEYS = Object.keys(ENDPOINT_LABELS) as Array<keyof Endpoints>;

	const AUTH_OPTIONS: Array<{ value: ClientAuth; label: string }> = [
		{ value: 'none', label: 'None (public client)' },
		{ value: 'client_secret_basic', label: 'client_secret_basic' },
		{ value: 'client_secret_post', label: 'client_secret_post' },
		{ value: 'client_secret_jwt', label: 'client_secret_jwt' }
	];
	const JWT_ALG_OPTIONS = ['HS256', 'HS384', 'HS512'].map((value) => ({ value }));
	const PROXY_OPTIONS = [
		{ value: 'none', label: 'No proxy' },
		{ value: 'system', label: 'System' },
		{ value: 'url', label: 'Custom URL' }
	];

	let discovering = $state(false);
	let result = $state<DiscoveryResult | null>(null);
	let confirmingApplyAll = $state(false);

	const success = $derived<DiscoverySuccess | null>(result?.ok ? result : null);
	const suggestions = $derived(success ? discoverySuggestions(success.document) : null);
	const supported = $derived.by((): Array<[string, string[]]> => {
		if (!suggestions) return [];
		const rows: Array<[string, string[]]> = [
			['Grant types', suggestions.grantTypes],
			['Response types', suggestions.responseTypes],
			['Scopes', suggestions.scopes],
			['Token endpoint auth methods', suggestions.tokenAuthMethods],
			['Code challenge methods', suggestions.codeChallengeMethods],
			['Response modes', suggestions.responseModes]
		];
		return rows.filter(([, values]) => values.length > 0);
	});
	const needsSecret = $derived(
		idp.client.auth === 'client_secret_basic' ||
			idp.client.auth === 'client_secret_post' ||
			idp.client.auth === 'client_secret_jwt'
	);
	const enabledHeaders = $derived(idp.http.headers.filter((row) => row.enabled).length);

	async function runDiscovery() {
		discovering = true;
		confirmingApplyAll = false;
		const log = newHttpLog();
		try {
			const next = await discover(ipc, idp, log, () => new Date());
			result = next;
			if (next.ok) {
				idp.discovery = next.document;
				idp.discoveredAt = next.discoveredAt;
				idp.endpoints = applyDiscovery(idp, next, { overwrite: false });
			}
			onDiscoveryResult({ error: next.ok ? null : next.error, exchanges: log.exchanges });
		} finally {
			discovering = false;
		}
	}

	function applyAll() {
		if (!result?.ok) return;
		idp.endpoints = applyDiscovery(idp, result, { overwrite: true });
		confirmingApplyAll = false;
	}
</script>

<div class="@container flex max-w-[44rem] flex-col">
	<FormSection id="idp.provider" title="Provider">
		<TextField label="Name" bind:value={idp.name} />
		<div class="flex items-end gap-2">
			<div class="flex-1">
				<TextField
					label="Issuer"
					mono
					bind:value={idp.issuer}
					placeholder="https://idp.example/realm"
				/>
			</div>
			<Button
				variant="primary"
				disabled={discovering || idp.issuer.trim() === ''}
				onclick={runDiscovery}
			>
				{discovering ? 'Discovering…' : 'Discover'}
			</Button>
		</div>

		{#if result && !result.ok}
			<p class="text-xs text-danger" role="alert">
				Discovery failed: {result.error.error}{result.error.error_description
					? ` — ${result.error.error_description}`
					: ''}
			</p>
		{/if}

		{#if success}
			<div class="flex flex-col gap-2 panel p-3" aria-label="Discovery result">
				{#each success.warnings as warning (warning)}
					<p class="text-xs text-warning" role="status">{warning}</p>
				{/each}
				<div class="flex items-center gap-2">
					{#if confirmingApplyAll}
						<span class="text-xs text-fg">Overwrite existing endpoints with discovered values?</span
						>
						<Button variant="danger" onclick={applyAll}>Confirm overwrite</Button>
						<Button variant="ghost" onclick={() => (confirmingApplyAll = false)}>Cancel</Button>
					{:else}
						<Button onclick={() => (confirmingApplyAll = true)}>Apply all</Button>
						<span class="text-xs text-fg-muted"
							>Empty endpoint fields were filled automatically.</span
						>
					{/if}
				</div>
				{#if supported.length > 0}
					<dl class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
						{#each supported as [title, values] (title)}
							<dt class="text-fg-muted">{title}</dt>
							<dd class="font-mono break-words">{values.join(', ')}</dd>
						{/each}
					</dl>
				{/if}
			</div>
		{/if}
	</FormSection>

	<FormSection id="idp.endpoints" title="Endpoints">
		{#each ENDPOINT_KEYS as key (key)}
			<TextField label={ENDPOINT_LABELS[key]} mono bind:value={idp.endpoints[key]} />
		{/each}
	</FormSection>

	<FormSection id="idp.client" title="Client">
		<TextField label="Client ID" mono bind:value={idp.client.clientId} />
		<div class="field-grid">
			<SelectField
				label="Client authentication"
				options={AUTH_OPTIONS}
				bind:value={idp.client.auth}
			/>
			{#if idp.client.auth === 'client_secret_jwt'}
				<SelectField
					label="Assertion algorithm"
					options={JWT_ALG_OPTIONS}
					bind:value={idp.client.jwtAlg}
				/>
			{/if}
		</div>
		{#if needsSecret}
			<SecretField
				label="Client secret"
				hasSecret={idp.client.hasSecret}
				onsave={(value) => store.setClientSecret(idp, value)}
				onclear={() => store.clearClientSecret(idp)}
			/>
		{/if}
	</FormSection>

	<FormSection id="idp.network" title="Network" defaultOpen={false}>
		{#snippet summary(open)}
			{#if !open}
				{#if idp.http.tlsInsecure}<Badge variant="danger">TLS validation off</Badge>{/if}
				{#if enabledHeaders > 0}
					<span class="text-xs text-fg-muted">
						{enabledHeaders}
						{enabledHeaders === 1 ? 'header' : 'headers'}
					</span>
				{/if}
				{#if idp.http.origin.trim() !== ''}<span class="text-xs text-fg-muted">Origin set</span
					>{/if}
			{/if}
		{/snippet}
		<KeyValueEditor
			label="Headers (back-channel requests)"
			addLabel="Add header"
			namePlaceholder="Header"
			bind:rows={idp.http.headers}
		/>
		<TlsInsecureToggle bind:checked={idp.http.tlsInsecure} />
		<div class="field-grid">
			<SelectField label="Proxy" options={PROXY_OPTIONS} bind:value={idp.http.proxy.mode} />
			<TextField
				label="Timeout (ms)"
				type="number"
				min="1"
				bind:value={
					() => String(idp.http.timeoutMs),
					(v) => {
						const n = Math.trunc(Number(v));
						if (n > 0) idp.http.timeoutMs = n;
					}
				}
			/>
		</div>
		{#if idp.http.proxy.mode === 'url'}
			<TextField
				label="Proxy URL"
				mono
				placeholder="http://proxy.local:8080"
				bind:value={idp.http.proxy.url}
			/>
		{/if}
		<TextField
			label="Origin"
			mono
			placeholder="https://app.example"
			hint="Sent as the Origin header on back-channel requests."
			bind:value={idp.http.origin}
		/>
		<Toggle label="Check CORS for this origin" bind:checked={idp.http.corsCheck} />
		<div>
			<Button onclick={onclearsession}>Clear browser session</Button>
		</div>
	</FormSection>
</div>
