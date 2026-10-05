<script lang="ts">
	import type { Run } from '#lib/model/run.js';
	import Button from '#lib/components/ui/Button.svelte';
	import CodeView from '#lib/components/ui/CodeView.svelte';
	import TokenView from './TokenView.svelte';

	interface Props {
		run: Run | null;
		/** Fetches UserInfo with the run's access token; the button only shows when provided. */
		onuserinfo?: () => void;
		/** Prefills a refresh_token flow with the run's refresh token. */
		onuserefresh?: (refreshToken: string) => void;
		userinfo?: unknown;
	}

	let { run, onuserinfo, onuserefresh, userinfo }: Props = $props();

	const tokens = $derived(run?.tokens);
</script>

{#if !run}
	<p class="p-4 text-fg-muted">No run yet</p>
{:else if !tokens}
	<p class="p-4 text-fg-muted">This run returned no tokens</p>
{:else}
	<div class="flex flex-col gap-3 p-3">
		{#if tokens.token_type || tokens.expires_in !== undefined || tokens.scope}
			<dl class="flex flex-wrap gap-x-6 gap-y-1 text-xs" data-testid="token-summary">
				{#if tokens.token_type}
					<div class="flex gap-1">
						<dt class="text-fg-muted">token_type</dt>
						<dd>{tokens.token_type}</dd>
					</div>
				{/if}
				{#if tokens.expires_in !== undefined}
					<div class="flex gap-1">
						<dt class="text-fg-muted">expires_in</dt>
						<dd>{tokens.expires_in}</dd>
					</div>
				{/if}
				{#if tokens.scope}
					<div class="flex gap-1">
						<dt class="text-fg-muted">scope</dt>
						<dd>{tokens.scope}</dd>
					</div>
				{/if}
			</dl>
		{/if}

		{#if tokens.access_token}
			<TokenView
				label="Access token"
				sigId="sig.access_token"
				token={tokens.access_token}
				validations={run.validations}
			/>
		{/if}
		{#if tokens.id_token}
			<TokenView
				label="ID token"
				sigId="sig.id_token"
				token={tokens.id_token}
				validations={run.validations}
			/>
		{/if}
		{#if tokens.refresh_token}
			<TokenView
				label="Refresh token"
				sigId="sig.refresh_token"
				token={tokens.refresh_token}
				validations={run.validations}
			/>
			{#if onuserefresh}
				<div>
					<Button onclick={() => onuserefresh(tokens.refresh_token!)}>Use refresh token</Button>
				</div>
			{/if}
		{/if}

		{#if onuserinfo || userinfo !== undefined}
			<section class="panel" aria-label="UserInfo">
				<div class="panel-header">
					<span>UserInfo</span>
					{#if onuserinfo}
						<Button onclick={onuserinfo} disabled={!tokens.access_token}>Call UserInfo</Button>
					{/if}
				</div>
				<div class="p-3">
					{#if userinfo !== undefined}
						<CodeView value={userinfo} />
					{:else}
						<p class="text-fg-muted">UserInfo has not been called</p>
					{/if}
				</div>
			</section>
		{/if}

		<section class="panel" aria-label="Raw token response">
			<div class="panel-header">Raw token response</div>
			<div class="p-3">
				<CodeView value={tokens.raw} />
			</div>
		</section>
	</div>
{/if}
