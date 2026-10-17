<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		title: string;
		size?: 'sm' | 'md' | 'lg';
		/** Turns the body into a form; the default submit closes the dialog. */
		onsubmit?: () => void;
		children: Snippet;
		/** Right side of the footer: the actions. */
		footer?: Snippet;
		/** Left side of the footer: secondary information. */
		aside?: Snippet;
	}

	let {
		open = $bindable(),
		title,
		size = 'sm',
		onsubmit,
		children,
		footer,
		aside
	}: Props = $props();

	const uid = $props.id();
	const WIDTHS = { sm: 'w-[26rem]', md: 'w-[34rem]', lg: 'w-[44rem]' } as const;

	let dialog: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	function submit(event: SubmitEvent) {
		if (!onsubmit) return;
		event.preventDefault();
		onsubmit();
	}
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{uid}-title"
	class="m-auto {WIDTHS[
		size
	]} max-w-[90vw] rounded-dialog border border-border bg-surface-raised p-0 text-fg shadow-float backdrop:bg-scrim"
	onclose={() => (open = false)}
>
	<form method="dialog" class="flex flex-col gap-4 p-5" onsubmit={submit}>
		<h2 id="{uid}-title" class="text-base font-semibold">{title}</h2>
		<div class="max-h-[70vh] space-y-4 overflow-y-auto">
			{@render children()}
		</div>
		{#if footer || aside}
			<div class="flex items-center justify-between gap-2">
				<div class="min-w-0 text-xs text-fg-muted">{@render aside?.()}</div>
				<div class="flex shrink-0 justify-end gap-2">{@render footer?.()}</div>
			</div>
		{/if}
	</form>
</dialog>
