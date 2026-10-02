<script lang="ts">
	interface Props {
		label: string;
		checked?: boolean;
		disabled?: boolean;
	}

	let { label, checked = $bindable(false), disabled = false }: Props = $props();
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	{disabled}
	class="inline-flex cursor-pointer items-center gap-2 text-sm text-fg select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
	onclick={() => (checked = !checked)}
>
	<span
		aria-hidden="true"
		class={[
			'relative h-4 w-7 shrink-0 rounded-full border border-border transition-colors',
			checked ? 'border-accent bg-accent' : 'bg-surface-sunken'
		]}
	>
		<span
			class={[
				'absolute top-px left-px size-3 rounded-full transition-transform',
				checked ? 'translate-x-3 bg-accent-fg' : 'bg-fg-muted'
			]}
		></span>
	</span>
	{label}
</button>
