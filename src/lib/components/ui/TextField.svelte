<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLInputAttributes, 'class' | 'value' | 'list'> {
		label: string;
		value?: string;
		hint?: string;
		error?: string;
		/** Id of a `<datalist>` offering suggestions. */
		list?: string;
		mono?: boolean;
	}

	let {
		label,
		value = $bindable(''),
		hint,
		error,
		list,
		mono = false,
		type = 'text',
		...rest
	}: Props = $props();

	const id = $props.id();
</script>

<div class="min-w-0">
	<label class="field-label" for="{id}-input">{label}</label>
	<input
		id="{id}-input"
		class={['input-field', mono && 'font-mono']}
		{type}
		{list}
		bind:value
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
		{...rest}
	/>
	{#if error}
		<p id="{id}-error" class="mt-1 text-xs text-danger">{error}</p>
	{:else if hint}
		<p id="{id}-hint" class="mt-1 text-xs text-fg-muted">{hint}</p>
	{/if}
</div>
