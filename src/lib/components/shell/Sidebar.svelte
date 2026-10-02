<script lang="ts">
	import type { Snippet } from 'svelte';
	import SelectField from '$lib/components/ui/SelectField.svelte';
	import type { SidebarIdp, SidebarWorkspace } from './types';

	interface Props {
		workspaces: SidebarWorkspace[];
		workspaceId: string;
		idps: SidebarIdp[];
		selectedFlowId?: string;
		onworkspacechange?: (workspaceId: string) => void;
		onselectflow?: (idpId: string, flowId: string) => void;
		/** Workspace-level buttons (save as, rename, delete, export, import, add IdP). */
		actions?: Snippet;
	}

	let {
		workspaces,
		workspaceId = $bindable(),
		idps,
		selectedFlowId,
		onworkspacechange,
		onselectflow,
		actions
	}: Props = $props();

	const workspaceName = $derived(workspaces.find((w) => w.id === workspaceId)?.name ?? '');
</script>

<aside aria-label="Sidebar" class="flex h-full min-h-0 flex-col bg-surface-raised">
	<div class="space-y-2 border-b border-border p-3">
		<SelectField
			label="Workspace"
			bind:value={workspaceId}
			options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
			onchange={(event) => onworkspacechange?.(event.currentTarget.value)}
		/>
		{#if actions}
			<div class="flex flex-wrap gap-1.5">{@render actions()}</div>
		{/if}
	</div>

	<div class="min-h-0 flex-1 overflow-auto p-2">
		<div class="panel-header border-b-0 px-1">{workspaceName}</div>
		{#if idps.length === 0}
			<p class="px-1 py-2 text-sm text-fg-muted">No IdPs yet</p>
		{:else}
			<ul role="tree" aria-label="IdPs and flows" class="space-y-2">
				{#each idps as idp (idp.id)}
					<li role="none">
						<div class="px-1 text-sm font-semibold">{idp.name}</div>
						<ul role="group" class="mt-0.5 border-l border-border pl-2">
							{#each idp.flows as flow (flow.id)}
								<li role="none">
									<button
										type="button"
										role="treeitem"
										aria-selected={flow.id === selectedFlowId}
										class={[
											'flex w-full cursor-pointer items-center justify-between gap-2 rounded-control px-2 py-1 text-left text-sm hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-accent',
											flow.id === selectedFlowId && 'bg-surface-sunken font-medium text-accent'
										]}
										onclick={() => onselectflow?.(idp.id, flow.id)}
									>
										<span class="truncate">{flow.name}</span>
										<span class="shrink-0 font-mono text-xs text-fg-muted">{flow.type}</span>
									</button>
								</li>
							{:else}
								<li role="none" class="px-2 py-1 text-xs text-fg-muted">No flows</li>
							{/each}
						</ul>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</aside>
