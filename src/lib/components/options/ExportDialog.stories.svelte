<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor, within } from 'storybook/test';
	import ExportDialog from './ExportDialog.svelte';

	const { Story } = defineMeta({
		title: 'Options/ExportDialog',
		component: ExportDialog,
		parameters: { layout: 'fullscreen' },
		args: {
			open: true,
			currentId: 'w1',
			workspaces: [
				{ id: 'scratchpad', name: 'Scratchpad' },
				{ id: 'w1', name: 'Keycloak dev' },
				{ id: 'w2', name: 'Entra prod' }
			],
			counts: (id: string) =>
				Promise.resolve(id === 'w1' ? { idps: 1, runs: 3 } : { idps: 2, runs: 0 }),
			onexport: fn()
		}
	});

	const body = () => within(document.querySelector('dialog')!);
</script>

<Story
	name="REQ-WS-012 only the current workspace is checked and options are off"
	parameters={{ req: ['REQ-WS-012'] }}
	play={async () => {
		const dialog = body();
		await expect(dialog.getByRole('checkbox', { name: /Keycloak dev/ })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: /Scratchpad/ })).not.toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: /Entra prod/ })).not.toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: 'Include run history' })).not.toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: 'Include settings' })).not.toBeChecked();
		await waitFor(() => expect(dialog.getByText('1 IdP, 3 runs')).toBeVisible());
		await expect(dialog.getAllByText('2 IdPs, 0 runs')).toHaveLength(2);
		await expect(dialog.getByRole('checkbox', { name: 'Select all' })).toHaveProperty(
			'indeterminate',
			true
		);
		await expect(
			dialog.getByText('Client secrets and passwords are never exported.')
		).toBeVisible();
	}}
/>

<Story
	name="REQ-WS-012 confirm label pluralizes and is disabled at zero"
	parameters={{ req: ['REQ-WS-012'] }}
	play={async ({ userEvent }) => {
		const dialog = body();
		await expect(dialog.getByRole('button', { name: 'Export 1 workspace' })).toBeEnabled();
		await userEvent.click(dialog.getByRole('checkbox', { name: 'Select all' }));
		await expect(dialog.getByRole('button', { name: 'Export 3 workspaces' })).toBeEnabled();
		await userEvent.click(dialog.getByRole('checkbox', { name: 'Select all' }));
		await expect(dialog.getByRole('button', { name: 'Export 0 workspaces' })).toBeDisabled();
	}}
/>

<Story
	name="REQ-WS-012 exporting passes the checked ids in list order and both options"
	parameters={{ req: ['REQ-WS-012'] }}
	play={async ({ userEvent, args }) => {
		const dialog = body();
		await userEvent.click(dialog.getByRole('checkbox', { name: /Scratchpad/ }));
		await userEvent.click(dialog.getByRole('checkbox', { name: 'Include run history' }));
		await userEvent.click(dialog.getByRole('checkbox', { name: 'Include settings' }));
		await userEvent.click(dialog.getByRole('button', { name: 'Export 2 workspaces' }));
		await expect(args.onexport).toHaveBeenCalledWith(['scratchpad', 'w1'], {
			runs: true,
			settings: true
		});
	}}
/>
