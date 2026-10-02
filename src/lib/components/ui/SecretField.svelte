<script lang="ts">
	import Button from './Button.svelte';

	interface Props {
		label: string;
		/** True when a value is already stored in the OS keychain. */
		hasSecret: boolean;
		/** Called with the typed value on blur; the field clears its own copy afterwards. */
		onsave: (value: string) => void;
		onclear: () => void;
		disabled?: boolean;
	}

	let { label, hasSecret, onsave, onclear, disabled = false }: Props = $props();

	let value = $state('');
	let revealed = $state(false);
	const id = $props.id();

	function save() {
		if (value === '') return;
		const typed = value;
		value = '';
		revealed = false;
		onsave(typed);
	}

	// Moving focus to this field's own buttons (Show/Clear) must not count as leaving it.
	function focusout(event: FocusEvent & { currentTarget: HTMLElement }) {
		const next = event.relatedTarget;
		if (next instanceof Node && event.currentTarget.contains(next)) return;
		save();
	}

	function clear() {
		value = '';
		onclear();
	}
</script>

<div class="min-w-0">
	<label class="field-label" for="{id}-input">{label}</label>
	<div class="flex items-center gap-1.5" onfocusout={focusout}>
		<input
			id="{id}-input"
			class="input-field font-mono"
			type={revealed ? 'text' : 'password'}
			autocomplete="off"
			placeholder={hasSecret ? '••••••••' : ''}
			{disabled}
			bind:value
		/>
		<Button
			variant="ghost"
			{disabled}
			onclick={() => (revealed = !revealed)}
			aria-pressed={revealed}
		>
			{revealed ? 'Hide' : 'Show'}
		</Button>
		{#if hasSecret}
			<Button variant="danger" {disabled} onclick={clear}>Clear</Button>
		{/if}
	</div>
	{#if hasSecret}
		<p class="mt-1 text-xs text-success">Stored in keychain</p>
	{/if}
</div>
