<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import Sidebar from './Sidebar.svelte';

	const { Story } = defineMeta({
		title: 'Shell/Sidebar',
		component: Sidebar,
		parameters: { layout: 'fullscreen' },
		args: {
			workspaces: [
				{ id: 'scratchpad', name: 'Scratchpad' },
				{ id: 'w1', name: 'Acme staging' }
			],
			workspaceId: 'scratchpad',
			onworkspacechange: fn(),
			onselectflow: fn(),
			idps: []
		}
	});
</script>

<Story
	name="Empty scratchpad"
	play={async ({ canvas }) => {
		await expect(canvas.getByLabelText('Workspace')).toHaveValue('scratchpad');
		await expect(canvas.getByText('No IdPs yet')).toBeVisible();
	}}
/>

<Story
	name="Tree and selection"
	args={{
		idps: [
			{
				id: 'i1',
				name: 'Mock IdP',
				flows: [
					{ id: 'f1', name: 'Auth code + PKCE', type: 'authorization_code_pkce' },
					{ id: 'f2', name: 'Service', type: 'client_credentials' }
				]
			},
			{ id: 'i2', name: 'Empty IdP', flows: [] }
		],
		selectedFlowId: 'f2'
	}}
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
	name="Switch workspace"
	play={async ({ canvas, userEvent, args }) => {
		await userEvent.selectOptions(canvas.getByLabelText('Workspace'), 'w1');
		await expect(args.onworkspacechange).toHaveBeenCalledTimes(1);
		await expect(args.onworkspacechange).toHaveBeenCalledWith('w1');
	}}
/>
