<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';

	interface Option {
		value: string;
		label?: string;
	}

	interface Props extends Omit<HTMLSelectAttributes, 'class' | 'value' | 'children'> {
		label: string;
		value?: string;
		options: Option[];
	}

	let { label, value = $bindable(''), options, ...rest }: Props = $props();

	const id = $props.id();
</script>

<div class="min-w-0">
	<label class="field-label" for="{id}-select">{label}</label>
	<select id="{id}-select" class="input-field" bind:value {...rest}>
		{#each options as option (option.value)}
			<option value={option.value}>{option.label ?? option.value}</option>
		{/each}
	</select>
</div>
