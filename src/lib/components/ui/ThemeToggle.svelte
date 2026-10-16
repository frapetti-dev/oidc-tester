<script lang="ts">
	import Monitor from '@lucide/svelte/icons/monitor';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import { THEME_MODES, themeController, type ThemeMode } from '#lib/theme/theme.js';

	const LABELS: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' };
	const ICONS: Record<ThemeMode, typeof Monitor> = { system: Monitor, light: Sun, dark: Moon };

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
		{@const Icon = ICONS[option]}
		<label
			title={LABELS[option]}
			class="grid size-7 cursor-pointer place-items-center rounded-control text-fg-muted select-none hover:text-fg has-checked:bg-surface-raised has-checked:text-accent has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-focus"
		>
			<input
				type="radio"
				class="sr-only"
				{name}
				value={option}
				checked={mode === option}
				onchange={() => select(option)}
			/>
			<Icon size={14} aria-hidden="true" />
			<span class="sr-only">{LABELS[option]}</span>
		</label>
	{/each}
</fieldset>
