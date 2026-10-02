<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		variant?: 'neutral' | 'success' | 'danger' | 'warning';
		children: Snippet;
	}

	let { variant = 'neutral', children }: Props = $props();
</script>

<span
	class={[
		'badge',
		variant === 'success' && 'badge-success',
		variant === 'danger' && 'badge-danger',
		variant === 'warning' && 'badge-warning'
	]}
>
	{@render children()}
</span>
