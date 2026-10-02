<script lang="ts">
	import type { Snippet } from 'svelte';
	import SelectField from '$lib/components/ui/SelectField.svelte';
	import type { SidebarFlow, SidebarIdp, SidebarWorkspace } from './types';

	interface Props {
		workspaces: SidebarWorkspace[];
		workspaceId: string;
		idps: SidebarIdp[];
		selectedFlowId?: string;
		selectedIdpId?: string;
		onselectidp?: (idpId: string) => void;
		/** Per-IdP buttons (add flow, duplicate, delete). */
		idpActions?: Snippet<[SidebarIdp]>;
		/** Per-flow buttons (duplicate, delete). */
		flowActions?: Snippet<[SidebarIdp, SidebarFlow]>;
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
		selectedIdpId,
		onselectidp,
		idpActions,
		flowActions,
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
		<div class="px-1 pt-1 pb-2 text-xs font-medium text-fg-muted">{workspaceName}</div>
		{#if idps.length === 0}
			<p class="px-1 py-2 text-sm text-fg-muted">No IdPs yet</p>
		{:else}
			<ul role="tree" aria-label="IdPs and flows" class="space-y-2">
				{#each idps as idp (idp.id)}
					<li role="none">
						<div class="flex items-center justify-between gap-1">
							<button
								type="button"
								class={[
									'min-w-0 flex-1 cursor-pointer truncate rounded-control px-1 py-0.5 text-left text-sm font-semibold hover:bg-surface-sunken',
									idp.id === selectedIdpId && 'text-accent'
								]}
								onclick={() => onselectidp?.(idp.id)}>{idp.name}</button
							>
							{#if idpActions}
								<div class="flex shrink-0 gap-0.5">{@render idpActions(idp)}</div>
							{/if}
						</div>
						<ul role="group" class="mt-1">
							{#each idp.flows as flow (flow.id)}
								<li role="none" class="flex items-center gap-0.5">
									<button
										type="button"
										role="treeitem"
										aria-selected={flow.id === selectedFlowId}
										class={[
											'flex min-w-0 flex-1 cursor-pointer flex-col items-start border-l-2 border-transparent px-2.5 py-1 text-left text-sm hover:bg-surface-sunken',
											flow.id === selectedFlowId && 'border-accent bg-surface-sunken font-semibold'
										]}
										onclick={() => onselectflow?.(idp.id, flow.id)}
									>
										<span class="max-w-full truncate">{flow.name}</span>
										<span
											class="max-w-full truncate font-mono text-[0.68rem] font-normal text-fg-muted"
											>{flow.type}</span
										>
									</button>
									{#if flowActions}
										<div class="flex shrink-0 gap-0.5">{@render flowActions(idp, flow)}</div>
									{/if}
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
