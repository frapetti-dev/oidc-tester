<script lang="ts">
	import { THEME_MODES, themeController, type ThemeMode } from '$lib/theme/theme';

	const LABELS: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' };

	const theme = themeController();
	const name = $props.id();
	let mode = $state<ThemeMode>(theme.mode);

	function select(next: ThemeMode) {
		mode = next;
		theme.set(next);
	}
</script>

<fieldset class="m-0 inline-flex rounded-control border border-border bg-surface-sunken p-0.5">
	<legend class="sr-only">Theme</legend>
	{#each THEME_MODES as option (option)}
		<label
			class="cursor-pointer rounded-sm px-2 py-0.5 text-xs font-medium text-fg-muted select-none hover:text-fg has-checked:bg-surface-raised has-checked:text-fg has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-accent"
		>
			<input
				type="radio"
				class="sr-only"
				{name}
				value={option}
				checked={mode === option}
				onchange={() => select(option)}
			/>
			{LABELS[option]}
		</label>
	{/each}
</fieldset>
