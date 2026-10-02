<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLButtonAttributes, 'class'> {
		variant?: 'default' | 'primary' | 'ghost' | 'danger';
	}

	let { variant = 'default', type = 'button', children, ...rest }: Props = $props();
</script>

<button
	{type}
	class={[
		'btn',
		variant === 'primary' && 'btn-primary',
		variant === 'ghost' && 'btn-ghost',
		variant === 'danger' && 'btn-danger'
	]}
	{...rest}
>
	{@render children?.()}
</button>
