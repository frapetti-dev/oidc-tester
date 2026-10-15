<script lang="ts">
	import AppWindow from '@lucide/svelte/icons/app-window';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Plus from '@lucide/svelte/icons/plus';
	import Server from '@lucide/svelte/icons/server';
	import { menu } from '#lib/components/ui/contextMenu.js';
	import type { MenuEntry } from '#lib/components/ui/menu.js';
	import { contextMenu } from '#lib/state/contextMenu.svelte.js';
	import type { SidebarClient, SidebarFlow, SidebarIdp } from './types';

	interface Props {
		idps: SidebarIdp[];
		selectedFlowId?: string;
		selectedClientId?: string;
		selectedIdpId?: string;
		onselectidp?: (idpId: string) => void;
		onselectclient?: (idpId: string, clientId: string) => void;
		onselectflow?: (idpId: string, clientId: string, flowId: string) => void;
		onaddidp?: () => void;
		/** REQ-UI-017: the `+` button on an IdP row creates a client immediately. */
		onaddclient?: (idpId: string) => void;
		canAddIdp?: boolean;
		/** REQ-UI-011: shown on right-click, the ContextMenu key and the "More actions" button. */
		idpMenu?: (idp: SidebarIdp) => MenuEntry[];
		clientMenu?: (idp: SidebarIdp, client: SidebarClient) => MenuEntry[];
		flowMenu?: (idp: SidebarIdp, client: SidebarClient, flow: SidebarFlow) => MenuEntry[];
		/** REQ-UI-017: the `+` button on a client row opens this flow-type picker; choosing creates the flow. */
		addFlowMenu?: (idp: SidebarIdp, client: SidebarClient) => MenuEntry[];
	}

	let {
		idps,
		selectedFlowId,
		selectedClientId,
		selectedIdpId,
		onselectidp,
		onselectclient,
		onselectflow,
		onaddidp,
		onaddclient,
		canAddIdp = true,
		idpMenu,
		clientMenu,
		flowMenu,
		addFlowMenu
	}: Props = $props();

	const ACTION_BUTTON =
		'btn btn-ghost btn-icon size-7 shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100';

	/**
	 * One selection rule for every level: the whole row is a rounded pill that is tinted on hover and
	 * selection, and only the deepest selected row also gets a 2px ink indicator inside its left edge.
	 */
	const ROW =
		'group relative flex items-center gap-0.5 rounded-control pr-1 hover:bg-surface-sunken';
	const SELECTED =
		'bg-surface-sunken [&>.btn]:opacity-100 before:absolute before:inset-y-1.5 before:left-0.5 before:w-0.5 before:rounded-full before:bg-fg';
	const ROW_BUTTON = 'min-w-0 flex-1 cursor-pointer rounded-control text-left';
	/** Containment line: indents the children of a row and draws a 1px rule down their left side. */
	const CHILDREN = 'border-l border-border';
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
			<p class="px-3 py-2 text-sm text-fg-muted">No IdPs yet</p>
		{:else}
			<ul role="tree" aria-label="IdPs, clients and flows" class="divide-y divide-border">
				{#each idps as idp (idp.id)}
					<li role="none" class="py-2 first:pt-0 last:pb-0">
						<div
							class={[ROW, idp.id === selectedIdpId && !selectedClientId && SELECTED]}
							{@attach menu(() => idpMenu?.(idp) ?? [], `Actions for ${idp.name}`)}
						>
							<button
								type="button"
								class={[ROW_BUTTON, 'flex items-center gap-2 py-1.5 pl-3 text-sm font-semibold']}
								onclick={() => onselectidp?.(idp.id)}
							>
								<Server size={14} class="shrink-0 text-fg-muted" aria-hidden="true" />
								<span class="truncate">{idp.name}</span>
							</button>
							{#if onaddclient}
								<button
									type="button"
									class={ACTION_BUTTON}
									aria-label="Add client to {idp.name}"
									onclick={() => onaddclient(idp.id)}
								>
									<Plus size={14} aria-hidden="true" />
								</button>
							{/if}
							{#if idpMenu}
								<button
									type="button"
									class={ACTION_BUTTON}
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
						<ul role="group" class={[CHILDREN, 'mt-0.5 ml-4 pl-1']}>
							{#each idp.clients as client (client.id)}
								<li role="none">
									<div
										class={[ROW, client.id === selectedClientId && !selectedFlowId && SELECTED]}
										{@attach menu(
											() => clientMenu?.(idp, client) ?? [],
											`Actions for ${client.name}`
										)}
									>
										<button
											type="button"
											class={[
												ROW_BUTTON,
												'flex items-center gap-2 py-1 pl-2.5 text-[0.8125rem] font-medium'
											]}
											onclick={() => onselectclient?.(idp.id, client.id)}
										>
											<AppWindow size={13} class="shrink-0 text-fg-muted" aria-hidden="true" />
											<span class="truncate">{client.name}</span>
										</button>
										{#if addFlowMenu}
											<button
												type="button"
												class={ACTION_BUTTON}
												aria-label="Add flow to {client.name}"
												aria-haspopup="menu"
												onclick={(event) =>
													contextMenu.openAt(
														event.currentTarget,
														addFlowMenu(idp, client),
														`Add flow to ${client.name}`
													)}
											>
												<Plus size={14} aria-hidden="true" />
											</button>
										{/if}
										{#if clientMenu}
											<button
												type="button"
												class={ACTION_BUTTON}
												aria-label="More actions for {client.name}"
												aria-haspopup="menu"
												onclick={(event) =>
													contextMenu.openAt(
														event.currentTarget,
														clientMenu(idp, client),
														`Actions for ${client.name}`
													)}
											>
												<Ellipsis size={14} aria-hidden="true" />
											</button>
										{/if}
									</div>
									<ul role="group" class={[CHILDREN, 'mt-px mb-1 ml-4.5 pl-1']}>
										{#each client.flows as flow (flow.id)}
											<li
												role="none"
												class={[ROW, flow.id === selectedFlowId && SELECTED]}
												{@attach menu(
													() => flowMenu?.(idp, client, flow) ?? [],
													`Actions for ${flow.name}`
												)}
											>
												<button
													type="button"
													role="treeitem"
													aria-selected={flow.id === selectedFlowId}
													class={[
														ROW_BUTTON,
														'flex flex-col items-start py-1 pl-2.5 text-[0.8125rem]',
														flow.id === selectedFlowId && 'font-semibold'
													]}
													onclick={() => onselectflow?.(idp.id, client.id, flow.id)}
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
														class={ACTION_BUTTON}
														aria-label="More actions for {flow.name}"
														aria-haspopup="menu"
														onclick={(event) =>
															contextMenu.openAt(
																event.currentTarget,
																flowMenu(idp, client, flow),
																`Actions for ${flow.name}`
															)}
													>
														<Ellipsis size={14} aria-hidden="true" />
													</button>
												{/if}
											</li>
										{:else}
											<li role="none" class="py-1 pl-3 text-xs text-fg-muted">No flows</li>
										{/each}
									</ul>
								</li>
							{:else}
								<li role="none" class="py-1 pl-3 text-xs text-fg-muted">No clients</li>
							{/each}
						</ul>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</aside>
