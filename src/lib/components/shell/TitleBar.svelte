<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import PanelLeft from '@lucide/svelte/icons/panel-left';
	import { contextMenu } from '$lib/state/contextMenu.svelte';
	import type { MenuEntry } from '$lib/components/ui/menu';
	import ThemeToggle from '$lib/components/ui/ThemeToggle.svelte';
	import type { RunIndicatorState, WorkspaceSummary } from './types';

	interface Props {
		workspaces: WorkspaceSummary[];
		workspaceId: string;
		onworkspacechange: (id: string) => void;
		workspaceMenu: () => MenuEntry[];
		showDrawerToggle: boolean;
		drawerOpen: boolean;
		ontoggledrawer: () => void;
		maximized: boolean;
		onminimize: () => void;
		ontogglemaximize: () => void;
		onclose: () => void;
		runState: RunIndicatorState;
	}

	let {
		workspaces,
		workspaceId,
		onworkspacechange,
		workspaceMenu,
		showDrawerToggle,
		drawerOpen,
		ontoggledrawer,
		maximized,
		onminimize,
		ontogglemaximize,
		onclose,
		runState
	}: Props = $props();

	const uid = $props.id();
	const WINDOW_BUTTON =
		"h-10 w-[46px] cursor-pointer font-['Segoe_Fluent_Icons','Segoe_MDL2_Assets'] text-[10px] text-fg hover:bg-surface-sunken";

	function ondblclick(event: MouseEvent & { currentTarget: HTMLElement }) {
		const target = event.target as HTMLElement;
		if (target === event.currentTarget || target.hasAttribute('data-tauri-drag-region')) {
			ontogglemaximize();
		}
	}
</script>

<!-- A window titlebar is intentionally a pointer-driven drag region; the buttons inside are keyboard reachable. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<header
	data-tauri-drag-region
	{ondblclick}
	class="relative flex h-10 shrink-0 items-center gap-2 bg-surface pl-2 select-none"
>
	{#if showDrawerToggle}
		<button
			type="button"
			class="btn btn-icon btn-ghost"
			aria-label="Show sidebar"
			aria-expanded={drawerOpen}
			onclick={ontoggledrawer}
		>
			<PanelLeft size={16} aria-hidden="true" />
		</button>
	{/if}
	<svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true" class="shrink-0">
		<rect x="5" y="0" width="6" height="3" rx="1.5" class="fill-jwt-header" />
		<rect x="0" y="4.5" width="16" height="3" rx="1.5" class="fill-jwt-payload" />
		<rect x="5" y="9" width="6" height="3" rx="1.5" class="fill-jwt-signature" />
	</svg>
	{#if !showDrawerToggle}
		<span class="text-sm font-semibold">OIDC Tester</span>
	{/if}
	<div class="h-5 w-px bg-border"></div>
	<label for="{uid}-workspace" class="sr-only">Workspace</label>
	<select
		id="{uid}-workspace"
		class="input-field h-7 w-auto max-w-56 py-0"
		value={workspaceId}
		onchange={(event) => onworkspacechange(event.currentTarget.value)}
	>
		{#each workspaces as workspace (workspace.id)}
			<option value={workspace.id}>{workspace.name}</option>
		{/each}
	</select>
	<button
		type="button"
		class="btn btn-icon size-7 btn-ghost"
		aria-label="Workspace actions"
		aria-haspopup="menu"
		onclick={(event) =>
			contextMenu.openAt(event.currentTarget, workspaceMenu(), 'Workspace actions')}
	>
		<Ellipsis size={14} aria-hidden="true" />
	</button>
	<div class="flex-1 self-stretch" data-tauri-drag-region></div>
	<ThemeToggle />
	<div class="flex">
		<button type="button" class={WINDOW_BUTTON} aria-label="Minimize" onclick={onminimize}>
			&#xE921;
		</button>
		<button
			type="button"
			class={WINDOW_BUTTON}
			aria-label={maximized ? 'Restore' : 'Maximize'}
			onclick={ontogglemaximize}
		>
			{maximized ? '\uE923' : '\uE922'}
		</button>
		<button
			type="button"
			class="{WINDOW_BUTTON} hover:bg-window-close hover:text-white"
			aria-label="Close"
			onclick={onclose}
		>
			&#xE8BB;
		</button>
	</div>
	<div
		data-testid="run-indicator"
		data-state={runState}
		aria-hidden="true"
		class="run-indicator absolute inset-x-0 bottom-0 flex h-0.5"
	>
		<div class="run-segment w-[14%]"></div>
		<div class="run-segment w-[72%]"></div>
		<div class="run-segment w-[14%]"></div>
	</div>
</header>

<style>
	.run-indicator > .run-segment {
		background-color: var(--c-border);
		transition: background-color 200ms;
	}
	[data-state='running'] > .run-segment:nth-child(1) {
		background-color: var(--c-jwt-header);
	}
	[data-state='running'] > .run-segment:nth-child(2) {
		background-color: var(--c-jwt-payload);
	}
	[data-state='running'] > .run-segment:nth-child(3) {
		background-color: var(--c-jwt-signature);
	}
	[data-state='success'] > .run-segment {
		background-color: var(--c-success);
	}
	[data-state='error'] > .run-segment {
		background-color: var(--c-danger);
	}
	/* A surface-colored gap sweeps left to right across the whole bar while running. */
	.run-indicator {
		overflow: hidden;
	}
	[data-state='running']::after {
		content: '';
		position: absolute;
		inset-block: 0;
		left: 0;
		width: 20%;
		background-color: var(--c-surface);
		animation: run-sweep 1.2s linear infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		[data-state='running']::after {
			display: none;
		}
	}
</style>
