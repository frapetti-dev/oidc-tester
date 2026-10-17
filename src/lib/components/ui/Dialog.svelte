<script lang="ts">
	import Button from './Button.svelte';
	import Modal from './Modal.svelte';
	import TextField from './TextField.svelte';

	interface Props {
		open: boolean;
		title: string;
		message?: string;
		/** Shows a text input with this label; its value is passed to `onconfirm`. */
		inputLabel?: string;
		initialValue?: string;
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
		confirmLabel = 'OK',
		danger = false,
		onconfirm
	}: Props = $props();

	let value = $state('');

	$effect(() => {
		if (open) value = initialValue;
	});

	const canConfirm = $derived(inputLabel === undefined || value.trim() !== '');

	function confirm() {
		if (!canConfirm) return;
		open = false;
		onconfirm(value.trim());
	}
</script>

<Modal bind:open {title} onsubmit={confirm}>
	{#if message}<p class="text-sm text-fg-muted">{message}</p>{/if}
	{#if inputLabel !== undefined}
		<TextField label={inputLabel} bind:value />
	{/if}
	{#snippet footer()}
		<Button onclick={() => (open = false)}>Cancel</Button>
		<Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={!canConfirm}>
			{confirmLabel}
		</Button>
	{/snippet}
</Modal>
