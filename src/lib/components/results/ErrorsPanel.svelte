<script lang="ts">
	import type { RunError, Validation } from '#lib/model/run.js';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import CodeView from '#lib/components/ui/CodeView.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { hintForError } from './errorHints';
	import ValidationList from './ValidationList.svelte';

	interface Props {
		error: RunError | null;
		validations?: Validation[];
		openLink?: (url: string) => void;
	}

	let { error, validations = [], openLink }: Props = $props();

	const problems = $derived(validations.filter((validation) => validation.level !== 'ok'));
	const hint = $derived(error ? hintForError(error.error) : undefined);
</script>

{#if !error && problems.length === 0}
	<EmptyState
		icon={ShieldCheck}
		title="No errors"
		description="Protocol errors and failed validations show up here."
	/>
{:else}
	<div class="flex flex-col gap-3 p-3">
		{#if error}
			<section class="flex flex-col gap-2 panel p-3" aria-label="Run error">
				<div class="flex flex-wrap items-center gap-2">
					<span data-testid="error-source"><Badge variant="danger">{error.source}</Badge></span>
					<span class="font-mono text-base font-semibold text-danger" data-testid="error-code"
						>{error.error}</span
					>
					{#if error.httpStatus !== undefined}
						<span data-testid="error-status"><Badge>HTTP {error.httpStatus}</Badge></span>
					{/if}
				</div>
				{#if error.error_description}
					<p class="text-fg" data-testid="error-description">{error.error_description}</p>
				{/if}
				{#if error.error_uri}
					<div data-testid="error-uri">
						<Button variant="ghost" onclick={() => openLink?.(error.error_uri!)}
							>{error.error_uri}</Button
						>
					</div>
				{/if}
				{#if hint}
					<p class="text-fg-muted" data-testid="error-hint">{hint}</p>
				{/if}
				{#if error.detail}
					<CodeView value={error.detail} />
				{/if}
			</section>
		{/if}
		{#if problems.length > 0}
			<section class="panel" aria-label="Validation problems">
				<div class="panel-header">Validation</div>
				<div class="p-3">
					<ValidationList validations={problems} />
				</div>
			</section>
		{/if}
	</div>
{/if}
