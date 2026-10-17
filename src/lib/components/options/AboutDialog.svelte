<script lang="ts">
	import {
		ISSUES_URL,
		MIT_LICENSE_TEXT,
		REPO_URL,
		diagnosticsText,
		filterLicenses,
		type LicenseEntry
	} from '#lib/about/about.js';
	import licenseData from '#lib/about/licenses.json';
	import AppMark from '#lib/components/ui/AppMark.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import TextField from '#lib/components/ui/TextField.svelte';
	import type { AppInfo } from '#lib/ipc/types.js';
	import { contextMenu } from '#lib/state/contextMenu.svelte.js';

	interface Props {
		open: boolean;
		/** Null until the host reported it. */
		info: AppInfo | null;
		onopenurl: (url: string) => void;
	}

	let { open = $bindable(), info, onopenurl }: Props = $props();

	// licenses.json is written by `pnpm licenses:gen`, whose entries match LicenseEntry.
	const licenses = licenseData.packages as LicenseEntry[];

	let query = $state('');
	const shown = $derived(filterLicenses(licenses, query));

	$effect(() => {
		if (open) query = '';
	});
</script>

<Modal bind:open title="About" size="md" onsubmit={() => (open = false)}>
	{#if open}
		<div class="flex items-center gap-5">
			<AppMark size={72} animate />
			<div>
				<p class="text-xl font-semibold">OIDC Tester</p>
				<p class="text-sm text-fg-muted">Version {info?.version ?? '…'}</p>
			</div>
		</div>
		<p class="text-sm">Test OAuth 2.0 and OpenID Connect flows against any identity provider.</p>

		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
			<dt class="text-fg-muted">Tauri</dt>
			<dd class="font-mono text-xs">{info?.tauriVersion ?? '…'}</dd>
			<dt class="text-fg-muted">WebView2</dt>
			<dd class="font-mono text-xs">{info?.webviewVersion ?? '…'}</dd>
			<dt class="text-fg-muted">OS</dt>
			<dd class="font-mono text-xs">{info?.os ?? '…'}</dd>
		</dl>

		<div class="flex flex-wrap gap-2">
			<Button
				disabled={info === null}
				onclick={() => info && void contextMenu.copy(diagnosticsText(info))}
			>
				Copy diagnostics
			</Button>
			<Button onclick={() => onopenurl(REPO_URL)}>Source code</Button>
			<Button onclick={() => onopenurl(ISSUES_URL)}>Report an issue</Button>
		</div>

		<details class="rounded-control border border-border">
			<summary class="cursor-pointer px-3 py-2 text-sm font-medium">License</summary>
			<pre class="max-h-64 code-block rounded-t-none border-0">{MIT_LICENSE_TEXT}</pre>
		</details>

		<details class="rounded-control border border-border">
			<summary class="cursor-pointer px-3 py-2 text-sm font-medium">
				Third-party licenses ({licenses.length})
			</summary>
			<div class="space-y-2 p-3 pt-1">
				<TextField label="Filter packages" bind:value={query} />
				<ul class="max-h-64 overflow-y-auto text-sm">
					{#each shown as entry (`${entry.source}:${entry.name}@${entry.version}`)}
						<li class="flex items-center gap-2 py-1">
							{#if entry.homepage}
								<button
									type="button"
									class="min-w-0 cursor-pointer truncate text-left text-accent hover:underline"
									onclick={() => entry.homepage && onopenurl(entry.homepage)}
								>
									{entry.name}
								</button>
							{:else}
								<span class="min-w-0 truncate">{entry.name}</span>
							{/if}
							<span class="font-mono text-xs text-fg-muted">{entry.version}</span>
							<span class="text-xs text-fg-muted">{entry.source}</span>
							<span class="ml-auto"><Badge>{entry.license}</Badge></span>
						</li>
					{:else}
						<li class="py-1 text-fg-muted">No packages match.</li>
					{/each}
				</ul>
			</div>
		</details>
	{/if}
	{#snippet footer()}
		<Button type="submit" variant="primary">Close</Button>
	{/snippet}
</Modal>
