<script lang="ts">
	import type { Run } from '#lib/model/run.js';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Button from '#lib/components/ui/Button.svelte';
	import CodeView from '#lib/components/ui/CodeView.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import TokenView from './TokenView.svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';

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

	let tokenTab = $state<string>();

	const tabs = $derived([
		...(tokens?.access_token ? [{ id: 'access', label: 'Access token' }] : []),
		...(tokens?.id_token ? [{ id: 'id', label: 'ID token' }] : []),
		...(tokens?.refresh_token ? [{ id: 'refresh', label: 'Refresh token' }] : []),
		...(onuserinfo || userinfo !== undefined ? [{ id: 'userinfo', label: 'UserInfo' }] : []),
		{ id: 'raw', label: 'Raw response' }
	]);
</script>

{#if !run}
	<EmptyState
		icon={KeyRound}
		title="No run yet"
		description="Run a flow to inspect its tokens here."
	/>
{:else if !tokens}
	<EmptyState icon={KeyRound} title="This run returned no tokens" />
{:else}
	<div class="flex h-full min-h-0 flex-col">
		{#if tokens.token_type || tokens.expires_in !== undefined || tokens.scope}
			<div class="shrink-0 border-b border-border px-3 py-3">
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
			</div>
		{/if}

		<Tabs label="Tokens" {tabs} bind:active={tokenTab}>
			{#snippet panel(id)}
				<div class="flex flex-col gap-3 p-3">
					{#if id === 'access' && tokens.access_token}
						<TokenView
							label="Access token"
							sigId="sig.access_token"
							token={tokens.access_token}
							validations={run.validations}
						/>
					{:else if id === 'id' && tokens.id_token}
						<TokenView
							label="ID token"
							sigId="sig.id_token"
							token={tokens.id_token}
							validations={run.validations}
						/>
					{:else if id === 'refresh' && tokens.refresh_token}
						<TokenView
							label="Refresh token"
							sigId="sig.refresh_token"
							token={tokens.refresh_token}
							validations={run.validations}
						/>
						{#if onuserefresh}
							<div>
								<Button onclick={() => onuserefresh(tokens.refresh_token!)}
									>Use refresh token</Button
								>
							</div>
						{/if}
					{:else if id === 'userinfo'}
						<section class="panel" aria-label="UserInfo">
							<div class="panel-header">
								<span>UserInfo</span>
								{#if onuserinfo}
									<Button onclick={onuserinfo} disabled={!tokens.access_token}>Call UserInfo</Button
									>
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
					{:else if id === 'raw'}
						<section class="panel" aria-label="Raw token response">
							<div class="panel-header">Raw token response</div>
							<div class="p-3">
								<CodeView value={tokens.raw} />
							</div>
						</section>
					{/if}
				</div>
			{/snippet}
		</Tabs>
	</div>
{/if}
