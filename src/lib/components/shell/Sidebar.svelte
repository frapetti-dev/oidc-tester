<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Plus from '@lucide/svelte/icons/plus';
	import { menu } from '#lib/components/ui/contextMenu.js';
	import type { MenuEntry } from '#lib/components/ui/menu.js';
	import { contextMenu } from '#lib/state/contextMenu.svelte.js';
	import type { SidebarFlow, SidebarIdp } from './types';

	interface Props {
		idps: SidebarIdp[];
		selectedFlowId?: string;
		selectedIdpId?: string;
		onselectidp?: (idpId: string) => void;
		onselectflow?: (idpId: string, flowId: string) => void;
		onaddidp?: () => void;
		canAddIdp?: boolean;
		/** REQ-UI-011: shown on right-click, the ContextMenu key and the "More actions" button. */
		idpMenu?: (idp: SidebarIdp) => MenuEntry[];
		flowMenu?: (idp: SidebarIdp, flow: SidebarFlow) => MenuEntry[];
	}

	let {
		idps,
		selectedFlowId,
		selectedIdpId,
		onselectidp,
		onselectflow,
		onaddidp,
		canAddIdp = true,
		idpMenu,
		flowMenu
	}: Props = $props();

	const MORE_BUTTON =
		'btn btn-ghost btn-icon size-7 shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100';
</script>

<aside aria-label="Sidebar" class="flex h-full min-h-0 flex-col bg-surface-raised">
	<div class="border-b border-border p-3">
		<button type="button" class="btn w-full" disabled={!canAddIdp} onclick={() => onaddidp?.()}>
			<Plus size={14} aria-hidden="true" />
			Add IdP
		</button>
	</div>

	<div class="min-h-0 flex-1 overflow-auto p-2">
		{#if idps.length === 0}
			<p class="px-1 py-2 text-sm text-fg-muted">No IdPs yet</p>
		{:else}
			<ul role="tree" aria-label="IdPs and flows" class="space-y-2">
				{#each idps as idp (idp.id)}
					<li role="none">
						<div
							class="group flex items-center gap-1 rounded-control"
							{@attach menu(() => idpMenu?.(idp) ?? [], `Actions for ${idp.name}`)}
						>
							<button
								type="button"
								class={[
									'min-w-0 flex-1 cursor-pointer truncate rounded-control px-1.5 py-1 text-left text-sm font-semibold hover:bg-surface-sunken',
									idp.id === selectedIdpId && 'bg-surface-sunken'
								]}
								onclick={() => onselectidp?.(idp.id)}>{idp.name}</button
							>
							<span class="text-xs text-fg-muted" aria-hidden="true">{idp.flows.length}</span>
							{#if idpMenu}
								<button
									type="button"
									class={[MORE_BUTTON, idp.id === selectedIdpId && 'opacity-100']}
									aria-label="More actions for {idp.name}"
									aria-haspopup="menu"
									onclick={(event) =>
										contextMenu.openAt(
											event.currentTarget,
											idpMenu(idp),
											`Actions for ${idp.name}`
										)}
								>
									<Ellipsis size={14} aria-hidden="true" />
								</button>
							{/if}
						</div>
						<ul role="group" class="mt-1">
							{#each idp.flows as flow (flow.id)}
								<li
									role="none"
									class="group flex items-center gap-0.5"
									{@attach menu(() => flowMenu?.(idp, flow) ?? [], `Actions for ${flow.name}`)}
								>
									<button
										type="button"
										role="treeitem"
										aria-selected={flow.id === selectedFlowId}
										class={[
											'flex min-w-0 flex-1 cursor-pointer flex-col items-start border-l-2 px-2.5 py-1 text-left text-sm hover:bg-surface-sunken',
											flow.id === selectedFlowId
												? 'border-fg bg-surface-sunken font-semibold'
												: 'border-transparent'
										]}
										onclick={() => onselectflow?.(idp.id, flow.id)}
									>
										<span class="max-w-full truncate">{flow.name}</span>
										<span
											class="max-w-full truncate font-mono text-[0.68rem] font-normal text-fg-muted"
											>{flow.type}</span
										>
									</button>
									{#if flowMenu}
										<button
											type="button"
											class={[MORE_BUTTON, flow.id === selectedFlowId && 'opacity-100']}
											aria-label="More actions for {flow.name}"
											aria-haspopup="menu"
											onclick={(event) =>
												contextMenu.openAt(
													event.currentTarget,
													flowMenu(idp, flow),
													`Actions for ${flow.name}`
												)}
										>
											<Ellipsis size={14} aria-hidden="true" />
										</button>
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
