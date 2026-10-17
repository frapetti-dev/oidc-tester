<script lang="ts">
	import { untrack } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import SelectField from '#lib/components/ui/SelectField.svelte';
	import TextField from '#lib/components/ui/TextField.svelte';
	import ThemeToggle from '#lib/components/ui/ThemeToggle.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';
	import type { SettingsStore } from '#lib/state/settings.svelte.js';

	interface Props {
		open: boolean;
		settings: SettingsStore;
		/** Empty until the host reported it. */
		dataDir: string;
		onreveal: () => void;
		onclearsession: () => void;
	}

	let { open = $bindable(), settings, dataDir, onreveal, onclearsession }: Props = $props();

	const PROXY_OPTIONS = [
		{ value: 'none', label: 'No proxy' },
		{ value: 'system', label: 'System proxy' },
		{ value: 'url', label: 'Custom URL' }
	];

	let timeoutText = $state('');
	let limitText = $state('');

	$effect(() => {
		if (!open) return;
		untrack(() => {
			timeoutText = String(settings.current.newIdp.timeoutMs);
			limitText = String(settings.current.runHistoryLimit);
		});
	});

	/** A `type=number` input binds a number (null when empty), so normalise before parsing. */
	function wholeNumber(value: unknown): number | null {
		const text = value === null || value === undefined ? '' : String(value).trim();
		return /^\d+$/.test(text) ? Number(text) : null;
	}

	const timeoutError = $derived(
		(wholeNumber(timeoutText) ?? 0) > 0 ? undefined : 'Enter a whole number above 0'
	);
	const limitError = $derived(
		wholeNumber(limitText) === null ? 'Enter 0 or a whole number' : undefined
	);

	function setTimeoutText(text: string) {
		timeoutText = text;
		const n = wholeNumber(text);
		if (n !== null && n > 0) settings.update((s) => (s.newIdp.timeoutMs = n));
	}

	function setLimitText(text: string) {
		limitText = text;
		const n = wholeNumber(text);
		if (n !== null) settings.update((s) => (s.runHistoryLimit = n));
	}

	function done() {
		open = false;
		void settings.flush();
	}
</script>

<Modal bind:open title="Settings" size="lg" onsubmit={done}>
	{#if open}
		<div class="space-y-6">
			<section aria-labelledby="settings-appearance" class="space-y-3">
				<h3 id="settings-appearance" class="text-sm font-semibold">Appearance</h3>
				<ThemeToggle labeled />
			</section>

			<section aria-labelledby="settings-idps" class="space-y-3">
				<h3 id="settings-idps" class="text-sm font-semibold">New IdPs</h3>
				<div class="field-grid">
					<TextField
						label="Timeout (ms)"
						type="number"
						min="1"
						bind:value={() => timeoutText, setTimeoutText}
						error={timeoutError}
					/>
					<SelectField
						label="Proxy"
						options={PROXY_OPTIONS}
						bind:value={
							() => settings.current.newIdp.proxy.mode,
							(mode) =>
								settings.update((s) => {
									s.newIdp.proxy.mode = mode === 'none' || mode === 'url' ? mode : 'system';
								})
						}
					/>
					{#if settings.current.newIdp.proxy.mode === 'url'}
						<TextField
							label="Proxy URL"
							mono
							bind:value={
								() => settings.current.newIdp.proxy.url,
								(url) => settings.update((s) => (s.newIdp.proxy.url = url))
							}
						/>
					{/if}
				</div>
				<Toggle
					label="Skip TLS validation"
					bind:checked={
						() => settings.current.newIdp.tlsInsecure,
						(checked) => settings.update((s) => (s.newIdp.tlsInsecure = checked))
					}
				/>
				<p class="text-xs text-fg-muted">Applies to IdPs you add from now on.</p>
			</section>

			<section aria-labelledby="settings-flows" class="space-y-3">
				<h3 id="settings-flows" class="text-sm font-semibold">New flows</h3>
				<TextField
					label="Redirect URI"
					mono
					hint="Used by flows you add from now on. It never has to resolve."
					bind:value={
						() => settings.current.newFlow.redirectUri,
						(uri) => settings.update((s) => (s.newFlow.redirectUri = uri))
					}
				/>
			</section>

			<section aria-labelledby="settings-history" class="space-y-3">
				<h3 id="settings-history" class="text-sm font-semibold">Run history</h3>
				<TextField
					label="Runs kept per workspace"
					type="number"
					min="0"
					hint="0 keeps every run. Older runs are deleted after the next run."
					bind:value={() => limitText, setLimitText}
					error={limitError}
				/>
			</section>

			<section aria-labelledby="settings-data" class="space-y-3">
				<h3 id="settings-data" class="text-sm font-semibold">Data and session</h3>
				<div>
					<p class="field-label">Data folder</p>
					<p class="font-mono text-xs break-all">{dataDir || 'Unavailable'}</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<Button onclick={onreveal} disabled={dataDir === ''}>Show in Explorer</Button>
					<Button variant="danger" onclick={onclearsession}>Clear auth browser session</Button>
				</div>
				<p class="text-xs text-fg-muted">Signs the auth popup out of every IdP.</p>
			</section>
		</div>
	{/if}
	{#snippet aside()}Changes apply as you make them.{/snippet}
	{#snippet footer()}
		<Button type="submit" variant="primary">Done</Button>
	{/snippet}
</Modal>
