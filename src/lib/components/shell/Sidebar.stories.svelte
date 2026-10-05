<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import ContextMenuHost from '#lib/components/ui/ContextMenuHost.svelte';
	import Sidebar from './Sidebar.svelte';

	const MOCK_IDPS = [
		{
			id: 'i1',
			name: 'Mock IdP',
			flows: [
				{ id: 'f1', name: 'Auth code + PKCE', type: 'authorization_code_pkce' as const },
				{ id: 'f2', name: 'Service', type: 'client_credentials' as const }
			]
		},
		{ id: 'i2', name: 'Empty IdP', flows: [] }
	];

	const { Story } = defineMeta({
		title: 'Shell/Sidebar',
		component: Sidebar,
		parameters: { layout: 'fullscreen' },
		args: { onselectflow: fn(), onaddidp: fn(), idps: [] }
	});
</script>

<Story
	name="Empty scratchpad"
	play={async ({ canvas, userEvent, args }) => {
		await expect(canvas.getByText('No IdPs yet')).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Add IdP' }));
		await expect(args.onaddidp).toHaveBeenCalledTimes(1);
	}}
/>

<Story
	name="Tree and selection"
	args={{ idps: MOCK_IDPS, selectedFlowId: 'f2' }}
	play={async ({ canvas, userEvent, args }) => {
		await expect(canvas.queryByText('No IdPs yet')).toBeNull();
		await expect(canvas.getByText('Mock IdP')).toBeVisible();
		await expect(canvas.getByText('No flows')).toBeVisible();
		await expect(canvas.getByRole('treeitem', { name: /Service/ })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await userEvent.click(canvas.getByRole('treeitem', { name: /Auth code \+ PKCE/ }));
		await expect(args.onselectflow).toHaveBeenCalledTimes(1);
		await expect(args.onselectflow).toHaveBeenCalledWith('i1', 'f1');
	}}
/>

<Story
	name="REQ-UI-011 row menu via More actions button"
	parameters={{ req: ['REQ-UI-011'] }}
	args={{
		idps: MOCK_IDPS,
		idpMenu: () => [
			{ label: 'Add flow…', onselect: fn() },
			{ label: 'Duplicate', onselect: fn() },
			{ label: 'Rename…', onselect: fn() },
			'separator',
			{ label: 'Delete…', danger: true, onselect: fn() }
		]
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'More actions for Mock IdP' }));
		const items = await canvas.findAllByRole('menuitem');
		await expect(items.map((el) => el.textContent?.trim())).toEqual([
			'Add flow…',
			'Duplicate',
			'Rename…',
			'Delete…'
		]);
	}}
>
	{#snippet template(args)}
		<Sidebar {...args} />
		<ContextMenuHost />
	{/snippet}
</Story>
