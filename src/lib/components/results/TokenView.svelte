<script lang="ts">
	import type { Validation } from '#lib/model/run.js';
	import { inspectToken, splitTokenSegments, type TokenSegment } from '#lib/jwt/decode.js';
	import {
		claimLabel,
		describeClaim,
		rawClaimValue,
		viewClaim,
		type ClaimView
	} from '#lib/jwt/claims.js';
	import Copy from '@lucide/svelte/icons/copy';
	import InfoTip from '#lib/components/ui/InfoTip.svelte';
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

	// Relative dates refresh every 30 s unless a fixed reference time is given (stories/tests).
	let clock = $state(Date.now());
	$effect(() => {
		if (now !== undefined) return;
		const timer = setInterval(() => (clock = Date.now()), 30_000);
		return () => clearInterval(timer);
	});
	const at = $derived(now ?? clock);

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
				onselect: () => contextMenu.copy(rawClaimValue(value))
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
			<table
				class="w-full text-left text-xs [&_.badge]:py-0 [&_.badge]:leading-3.5"
				data-testid="claims-table"
			>
				<thead>
					<tr class="text-fg-muted">
						<th class="py-1 pr-3 font-medium">Claim</th>
						<th class="py-1 pr-3 font-medium">Label</th>
						<th class="py-1 pr-3 font-medium">Value</th>
						<th class="w-0"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each claims as [name, value] (name)}
						{@const description = describeClaim(name)}
						<tr
							class="group border-t border-border align-top"
							data-testid="claim-row"
							data-claim={name}
							{@attach menu(() => claimMenu(name, value), `Actions for claim ${name}`)}
						>
							<td class="py-1 pr-3">
								<span class="inline-flex items-center gap-1">
									<span class="font-mono text-jwt-payload">{name}</span>
									{#if description}<InfoTip label="About {name}" text={description} />{/if}
								</span>
							</td>
							<td class="py-1 pr-3 whitespace-nowrap text-fg-muted" data-testid="claim-label"
								>{claimLabel(name) ?? ''}</td
							>
							<td class="min-w-0 py-1 pr-3" data-testid="claim-value">
								{@render claimValue(viewClaim(name, value, at))}
							</td>
							<td class="py-1 align-top">
								<button
									type="button"
									class="-my-1 inline-grid size-6 cursor-pointer place-items-center text-fg opacity-0 group-focus-within:opacity-60 group-hover:opacity-60 hover:opacity-100 focus-visible:opacity-100"
									aria-label="Copy {name} value"
									onclick={() => contextMenu.copy(rawClaimValue(value))}
								>
									<Copy size={16} aria-hidden="true" />
								</button>
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

{#snippet claimValue(view: ClaimView)}
	{#if view.kind === 'text'}
		<span class="font-mono break-all">{view.text}</span>
	{:else if view.kind === 'date'}
		<span class="flex flex-wrap items-center gap-x-2 gap-y-1">
			<time datetime={view.iso} class="tabular-nums">{view.readable}</time>
			<Badge variant={view.badge.variant}>{view.badge.text}</Badge>
		</span>
	{:else if view.kind === 'list'}
		<ol class="flex flex-col gap-0.5">
			{#each view.items as item, index (index)}
				<li class="flex flex-wrap gap-x-3">
					<span class="font-mono break-all">{item.value}</span>
					{#if item.description}
						<span class="text-fg-muted" data-testid="claim-item-description"
							>{item.description}</span
						>
					{/if}
				</li>
			{/each}
		</ol>
	{:else if view.kind === 'flag'}
		<Badge variant={view.verified ? 'success' : 'warning'}>
			{view.verified ? 'verified' : 'not verified'}
		</Badge>
	{:else}
		<pre class="max-h-48 code-block p-2">{view.json}</pre>
	{/if}
{/snippet}
