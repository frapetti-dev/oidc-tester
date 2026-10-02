<script lang="ts">
	import FlowEditor from '$lib/components/shell/FlowEditor.svelte';
	import ResultsPanel from '$lib/components/shell/ResultsPanel.svelte';
	import Sidebar from '$lib/components/shell/Sidebar.svelte';
	import SplitPane from '$lib/components/ui/SplitPane.svelte';
	import ThemeToggle from '$lib/components/ui/ThemeToggle.svelte';

	// Placeholder shell state; the workspace store replaces it in a later phase.
	let workspaceId = $state('scratchpad');
</script>

<div class="flex h-screen flex-col">
	<header
		class="flex shrink-0 items-center justify-between border-b border-border bg-surface-raised px-3 py-1.5"
	>
		<span class="text-sm font-semibold">OIDC Tester</span>
		<ThemeToggle />
	</header>
	<div class="min-h-0 flex-1">
		<SplitPane size={280} min={200} max={480} label="Resize sidebar">
			{#snippet start()}
				<Sidebar
					workspaces={[{ id: 'scratchpad', name: 'Scratchpad' }]}
					bind:workspaceId
					idps={[]}
				/>
			{/snippet}
			{#snippet end()}
				<SplitPane fixed="end" size={440} min={300} max={900} label="Resize results">
					{#snippet start()}
						<FlowEditor />
					{/snippet}
					{#snippet end()}
						<ResultsPanel />
					{/snippet}
				</SplitPane>
			{/snippet}
		</SplitPane>
	</div>
</div>
