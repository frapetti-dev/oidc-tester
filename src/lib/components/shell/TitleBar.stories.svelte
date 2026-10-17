<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import ContextMenuHost from '#lib/components/ui/ContextMenuHost.svelte';
	import type { MenuEntry } from '#lib/components/ui/menu.js';
	import TitleBar from './TitleBar.svelte';

	const { Story } = defineMeta({
		title: 'Shell/TitleBar',
		component: TitleBar,
		parameters: { layout: 'fullscreen' },
		args: {
			workspaces: [
				{ id: 'scratchpad', name: 'Scratchpad' },
				{ id: 'w1', name: 'Acme staging' }
			],
			workspaceId: 'scratchpad',
			onworkspacechange: fn(),
			workspaceMenu: () => [],
			optionsMenu: (): MenuEntry[] => [
				{ label: 'Export…', onselect: fn() },
				{ label: 'Import…', onselect: fn() },
				'separator',
				{ label: 'Settings…', onselect: fn() },
				{ label: 'About OIDC Tester', onselect: fn() }
			],
			showDrawerToggle: false,
			drawerOpen: false,
			ontoggledrawer: fn(),
			maximized: false,
			onminimize: fn(),
			ontogglemaximize: fn(),
			onclose: fn(),
			runState: 'idle'
		}
	});
</script>

<Story
	name="REQ-UI-007 window buttons call their handlers"
	parameters={{ req: ['REQ-UI-007'] }}
	play={async ({ canvas, userEvent, args }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Minimize' }));
		await userEvent.click(canvas.getByRole('button', { name: 'Maximize' }));
		await userEvent.click(canvas.getByRole('button', { name: 'Close' }));
		await expect(args.onminimize).toHaveBeenCalledTimes(1);
		await expect(args.ontogglemaximize).toHaveBeenCalledTimes(1);
		await expect(args.onclose).toHaveBeenCalledTimes(1);
		await expect(canvas.getByRole('banner')).toHaveAttribute('data-tauri-drag-region');
	}}
/>

<Story
	name="REQ-UI-007 maximized window offers Restore and double-click toggles"
	parameters={{ req: ['REQ-UI-007'] }}
	args={{ maximized: true }}
	play={async ({ canvas, userEvent, args }) => {
		await expect(canvas.getByRole('button', { name: 'Restore' })).toBeVisible();
		await expect(canvas.queryByRole('button', { name: 'Maximize' })).toBeNull();
		await userEvent.dblClick(canvas.getByRole('banner'));
		await expect(args.ontogglemaximize).toHaveBeenCalled();
	}}
/>

<Story
	name="REQ-UI-008 run indicator reflects runState idle"
	parameters={{ req: ['REQ-UI-008'] }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('run-indicator')).toHaveAttribute('data-state', 'idle');
	}}
/>

<Story
	name="REQ-UI-008 run indicator reflects runState running"
	parameters={{ req: ['REQ-UI-008'] }}
	args={{ runState: 'running' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('run-indicator')).toHaveAttribute('data-state', 'running');
	}}
/>

<Story
	name="REQ-UI-008 run indicator reflects runState success"
	parameters={{ req: ['REQ-UI-008'] }}
	args={{ runState: 'success' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('run-indicator')).toHaveAttribute('data-state', 'success');
	}}
/>

<Story
	name="REQ-UI-008 run indicator reflects runState error"
	parameters={{ req: ['REQ-UI-008'] }}
	args={{ runState: 'error' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('run-indicator')).toHaveAttribute('data-state', 'error');
	}}
/>

<Story
	name="Narrow layout shows the drawer toggle"
	args={{ showDrawerToggle: true }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: 'Show sidebar' })).toHaveAttribute(
			'aria-expanded',
			'false'
		);
	}}
/>

<Story
	name="REQ-UI-024 Options button opens the Options menu"
	parameters={{ req: ['REQ-UI-024'] }}
	play={async ({ canvas, userEvent }) => {
		await expect(canvas.queryByRole('radio', { name: 'Dark' })).toBeNull();
		const button = canvas.getByRole('button', { name: 'Options' });
		await expect(button).toHaveAttribute('aria-haspopup', 'menu');
		await userEvent.click(button);
		await canvas.findByRole('menu', { name: 'Options' });
		const items = canvas.getAllByRole('menuitem');
		await expect(items.map((el) => el.textContent?.trim())).toEqual([
			'Export…',
			'Import…',
			'Settings…',
			'About OIDC Tester'
		]);
	}}
>
	{#snippet template(args)}
		<TitleBar {...args} />
		<ContextMenuHost />
	{/snippet}
</Story>
