<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import ContextMenuHost from '#lib/components/ui/ContextMenuHost.svelte';
	import Sidebar from './Sidebar.svelte';

	const MOCK_IDPS = [
		{
			id: 'i1',
			name: 'Mock IdP',
			clients: [
				{
					id: 'c1',
					name: 'Web app',
					flows: [
						{ id: 'f1', name: 'Auth code + PKCE', type: 'authorization_code_pkce' as const },
						{ id: 'f2', name: 'Service', type: 'client_credentials' as const }
					]
				},
				{ id: 'c2', name: 'Bare client', flows: [] }
			]
		},
		{ id: 'i2', name: 'Empty IdP', clients: [] }
	];

	const { Story } = defineMeta({
		title: 'Shell/Sidebar',
		component: Sidebar,
		parameters: { layout: 'fullscreen' },
		args: { onselectidp: fn(), onselectclient: fn(), onselectflow: fn(), onaddidp: fn(), idps: [] }
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
	args={{ idps: MOCK_IDPS, selectedIdpId: 'i1', selectedClientId: 'c1', selectedFlowId: 'f2' }}
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
		await expect(args.onselectflow).toHaveBeenCalledWith('i1', 'c1', 'f1');
	}}
/>

<Story
	name="REQ-UI-016 IdP > Client > Flow tree"
	parameters={{ req: ['REQ-UI-016'] }}
	args={{ idps: MOCK_IDPS, selectedIdpId: 'i1', selectedClientId: 'c1', selectedFlowId: 'f1' }}
	play={async ({ canvas, userEvent, args }) => {
		await expect(canvas.getByText('Mock IdP')).toBeVisible();
		await expect(canvas.getByRole('button', { name: /Web app/ })).toBeVisible();
		await expect(canvas.getByRole('treeitem', { name: /Auth code \+ PKCE/ })).toBeVisible();
		await expect(canvas.getByText('No clients')).toBeVisible();
		await expect(canvas.getByText('No flows')).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: /Web app/ }));
		await expect(args.onselectclient).toHaveBeenCalledWith('i1', 'c1');
	}}
/>

<Story
	name="REQ-UI-011 row menu via More actions button"
	parameters={{ req: ['REQ-UI-011'] }}
	args={{
		idps: MOCK_IDPS,
		idpMenu: () => [
			{ label: 'Add client', onselect: fn() },
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
			'Add client',
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

<Story
	name="REQ-UI-011 client row menu via More actions button"
	parameters={{ req: ['REQ-UI-011'] }}
	args={{
		idps: MOCK_IDPS,
		clientMenu: () => [
			{ label: 'Duplicate', onselect: fn() },
			{ label: 'Rename…', onselect: fn() },
			'separator',
			{ label: 'Delete…', danger: true, onselect: fn() }
		]
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'More actions for Web app' }));
		const items = await canvas.findAllByRole('menuitem');
		await expect(items.map((el) => el.textContent?.trim())).toEqual([
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

<Story
	name="REQ-UI-017 + buttons add a client and pick a flow type"
	parameters={{ req: ['REQ-UI-017'] }}
	args={{
		idps: MOCK_IDPS,
		onaddclient: fn(),
		addFlowMenu: () => [
			{ label: 'Authorization Code', onselect: fn() },
			{ label: 'Client Credentials', onselect: fn() }
		]
	}}
	play={async ({ canvas, userEvent, args }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Add client to Mock IdP' }));
		await expect(args.onaddclient).toHaveBeenCalledWith('i1');
		await expect(canvas.queryByRole('dialog')).toBeNull();

		await userEvent.click(canvas.getByRole('button', { name: 'Add flow to Web app' }));
		const items = await canvas.findAllByRole('menuitem');
		await expect(items.map((el) => el.textContent?.trim())).toEqual([
			'Authorization Code',
			'Client Credentials'
		]);
		await expect(canvas.queryByText('2', { selector: 'span' })).toBeNull();
	}}
>
	{#snippet template(args)}
		<Sidebar {...args} />
		<ContextMenuHost />
	{/snippet}
</Story>
