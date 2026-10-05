<script lang="ts">
	import Button from './Button.svelte';
	import SelectField from './SelectField.svelte';
	import TextField from './TextField.svelte';

	interface Props {
		open: boolean;
		title: string;
		message?: string;
		/** Shows a text input with this label; its value is passed to `onconfirm`. */
		inputLabel?: string;
		initialValue?: string;
		/** Shows a select with these options (labelled `inputLabel`) instead of a text input. */
		options?: { value: string; label: string }[];
		confirmLabel?: string;
		danger?: boolean;
		onconfirm: (value: string) => void;
	}

	let {
		open = $bindable(),
		title,
		message,
		inputLabel,
		initialValue = '',
		options,
		confirmLabel = 'OK',
		danger = false,
		onconfirm
	}: Props = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let value = $state('');

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			value = options?.[0]?.value ?? initialValue;
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	const canConfirm = $derived(inputLabel === undefined || value.trim() !== '');

	function confirm(event: SubmitEvent) {
		event.preventDefault();
		if (!canConfirm) return;
		open = false;
		onconfirm(value.trim());
	}
</script>

<dialog
	bind:this={dialog}
	aria-label={title}
	class="m-auto w-[26rem] max-w-[90vw] rounded-dialog border border-border bg-surface-raised p-0 text-fg shadow-float backdrop:bg-scrim"
	onclose={() => (open = false)}
>
	<form class="space-y-4 p-5" onsubmit={confirm}>
		<h2 class="text-base font-semibold">{title}</h2>
		{#if message}<p class="text-sm text-fg-muted">{message}</p>{/if}
		{#if inputLabel !== undefined}
			{#if options}
				<SelectField label={inputLabel} bind:value {options} />
			{:else}
				<TextField label={inputLabel} bind:value />
			{/if}
		{/if}
		<div class="flex justify-end gap-2">
			<Button onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={!canConfirm}>
				{confirmLabel}
			</Button>
		</div>
	</form>
</dialog>
