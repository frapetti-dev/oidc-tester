<script lang="ts">
	import type { Validation } from '#lib/model/run.js';
	import { inspectToken, splitTokenSegments, type TokenSegment } from '#lib/jwt/decode.js';
	import { describeClaim, formatClaimValue } from '#lib/jwt/claims.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import CodeView from '#lib/components/ui/CodeView.svelte';
	import { menu } from '#lib/components/ui/contextMenu.js';
	import type { MenuEntry } from '#lib/components/ui/menu.js';
	import { contextMenu } from '#lib/state/contextMenu.svelte.js';
	import ValidationList from './ValidationList.svelte';

	interface Props {
		label: string;
		token: string;
		/** Validation id carrying the signature result, e.g. `sig.id_token`. */
		sigId: string;
		validations: Validation[];
		/** Reference time in ms for relative dates; defaults to the current time. */
		now?: number;
	}

	let { label, token, sigId, validations, now }: Props = $props();

	const SEGMENT_CLASS: Record<TokenSegment['part'], string> = {
		header: 'text-jwt-header',
		payload: 'text-jwt-payload',
		signature: 'text-jwt-signature',
		separator: 'text-fg-muted',
		raw: 'text-fg'
	};
	const SIGNATURE_CLASS = {
		ok: 'badge-success',
		warn: 'badge-warning',
		error: 'badge-danger'
	} as const;

	const inspected = $derived(inspectToken(token));
	const segments = $derived(splitTokenSegments(token));
	const signature = $derived(validations.find((validation) => validation.id === sigId));
	// "Signature valid (RS256, kid abc)" -> summary + hover-only details.
	let sigHover = $state(false);
	const signatureParts = $derived.by(() => {
		const message = signature?.message ?? 'Signature not checked';
		const at = message.indexOf(' (');
		return at < 0
			? { summary: message, detail: '' }
			: { summary: message.slice(0, at), detail: message.slice(at) };
	});
	const idTokenChecks = $derived(
		sigId === 'sig.id_token'
			? validations.filter((validation) => validation.id.startsWith('idt.'))
			: []
	);
	const claims = $derived(inspected.kind === 'jws' ? Object.entries(inspected.payload) : []);

	let copyStatus = $state<'idle' | 'copied' | 'failed'>('idle');
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyToken() {
		try {
			await navigator.clipboard.writeText(token);
			copyStatus = 'copied';
		} catch {
			copyStatus = 'failed';
		}
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copyStatus = 'idle'), 1500);
	}

	function tokenMenu(): MenuEntry[] {
		const entries: MenuEntry[] = [{ label: 'Copy token', onselect: () => contextMenu.copy(token) }];
		if (inspected.kind === 'jws' || inspected.kind === 'jwe') {
			const header = inspected.header;
			entries.push({
				label: 'Copy header JSON',
				onselect: () => contextMenu.copy(JSON.stringify(header, null, 2))
			});
		}
		if (inspected.kind === 'jws') {
			const payload = inspected.payload;
			entries.push({
				label: 'Copy payload JSON',
				onselect: () => contextMenu.copy(JSON.stringify(payload, null, 2))
			});
		}
		return entries;
	}

	function claimMenu(name: string, value: unknown): MenuEntry[] {
		return [
			{
				label: 'Copy value',
				onselect: () => contextMenu.copy(typeof value === 'string' ? value : JSON.stringify(value))
			},
			{ label: 'Copy claim name', onselect: () => contextMenu.copy(name) },
			{
				label: 'Copy as JSON',
				onselect: () => contextMenu.copy(JSON.stringify({ [name]: value }))
			}
		];
	}
</script>

<section class="panel" aria-label={label} {@attach menu(tokenMenu, `Actions for ${label}`)}>
	<div class="panel-header">
		<span>{label}</span>
		<span class="flex items-center gap-2 normal-case">
			{#if inspected.kind === 'jws'}
				<button
					type="button"
					data-testid="sig-badge"
					class={['badge cursor-pointer', signature && SIGNATURE_CLASS[signature.level]]}
					aria-label={signature ? `${signature.message} (click to copy)` : undefined}
					onclick={() => signature && contextMenu.copy(signature.message)}
					onmouseenter={() => (sigHover = true)}
					onmouseleave={() => (sigHover = false)}
					onfocus={() => (sigHover = true)}
					onblur={() => (sigHover = false)}
				>
					{signatureParts.summary}{#if signatureParts.detail}<span
							data-testid="sig-detail"
							class={sigHover ? 'inline' : 'hidden'}>{signatureParts.detail}</span
						>{/if}
				</button>
			{/if}
			<Button variant="ghost" onclick={copyToken}>
				{copyStatus === 'copied'
					? 'Copied'
					: copyStatus === 'failed'
						? 'Copy failed'
						: 'Copy token'}
			</Button>
		</span>
	</div>
	<div class="@container flex flex-col gap-3 p-3">
		{#if inspected.kind === 'jws'}
			<p class="font-mono text-xs leading-relaxed break-all" data-testid="token-encoded">
				{#each segments as segment, index (index)}<span
						data-testid="token-segment"
						data-part={segment.part}
						class={SEGMENT_CLASS[segment.part]}>{segment.text}</span
					>{/each}
			</p>
			<div class="grid gap-3 @2xl:grid-cols-2">
				<div class="min-w-0">
					<h4 class="field-label">Header</h4>
					<CodeView value={inspected.header} />
				</div>
				<div class="min-w-0">
					<h4 class="field-label">Payload</h4>
					<CodeView value={inspected.payload} />
				</div>
			</div>
			<table class="w-full text-left text-xs" data-testid="claims-table">
				<thead>
					<tr class="text-fg-muted">
						<th class="py-1 pr-3 font-medium">Claim</th>
						<th class="py-1 pr-3 font-medium">Value</th>
						<th class="py-1 font-medium">Description</th>
					</tr>
				</thead>
				<tbody>
					{#each claims as [name, value] (name)}
						{@const description = describeClaim(name)}
						<tr
							class="border-t border-border align-top"
							data-testid="claim-row"
							data-claim={name}
							{@attach menu(() => claimMenu(name, value), `Actions for claim ${name}`)}
						>
							<td class="py-1 pr-3 font-mono text-jwt-payload">{name}</td>
							<td class="py-1 pr-3 font-mono break-all">{formatClaimValue(name, value, now)}</td>
							<td class="py-1 text-fg-muted">
								{#if description}<span data-testid="claim-description">{description}</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if idTokenChecks.length > 0}
				<div data-testid="idt-checks">
					<h4 class="field-label">ID token validation</h4>
					<ValidationList validations={idTokenChecks} />
				</div>
			{/if}
		{:else if inspected.kind === 'jwe'}
			<p class="text-fg-muted">
				Encrypted token (JWE): the payload cannot be decoded, only the header is shown.
			</p>
			<CodeView value={inspected.header} />
			<p class="font-mono text-xs break-all" data-testid="token-raw">{token}</p>
		{:else}
			{#if inspected.kind === 'malformed'}
				<p class="flex items-center gap-2 text-danger" data-testid="token-malformed">
					<Badge variant="danger">malformed</Badge>
					{inspected.reason}
				</p>
			{:else}
				<p class="text-fg-muted">Opaque token (not a JWT): there is nothing to decode.</p>
			{/if}
			<p class="font-mono text-xs break-all" data-testid="token-raw">{token}</p>
		{/if}
	</div>
</section>
