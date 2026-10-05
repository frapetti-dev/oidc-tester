<script lang="ts">
	import type { KV } from '#lib/model/schema.js';
	import Button from './Button.svelte';

	interface Props {
		rows?: KV[];
		label?: string;
		addLabel?: string;
		namePlaceholder?: string;
		valuePlaceholder?: string;
	}

	let {
		rows = $bindable([]),
		label,
		addLabel = 'Add',
		namePlaceholder = 'name',
		valuePlaceholder = 'value'
	}: Props = $props();
</script>

<div class="min-w-0">
	{#if label}
		<div class="field-label">{label}</div>
	{/if}
	{#if rows.length === 0}
		<p class="mb-1.5 text-xs text-fg-muted">No entries</p>
	{:else}
		<div class="mb-1.5 kv-grid">
			{#each rows as row, i (row)}
				<input
					type="checkbox"
					class="check-field"
					aria-label="Enabled {i + 1}"
					bind:checked={row.enabled}
				/>
				<input
					class="input-field font-mono"
					aria-label="Name {i + 1}"
					placeholder={namePlaceholder}
					bind:value={row.name}
				/>
				<input
					class="input-field font-mono"
					aria-label="Value {i + 1}"
					placeholder={valuePlaceholder}
					bind:value={row.value}
				/>
				<Button
					variant="ghost"
					aria-label="Remove {i + 1}"
					onclick={() => (rows = rows.filter((r) => r !== row))}
				>
					✕
				</Button>
			{/each}
		</div>
	{/if}
	<Button onclick={() => (rows = [...rows, { name: '', value: '', enabled: true }])}>
		{addLabel}
	</Button>
</div>
