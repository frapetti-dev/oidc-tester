<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, within } from 'storybook/test';
	import { newClient, newFlow, newIdp, newWorkspace } from '#lib/model/schema.js';
	import type { BundleEntry } from '#lib/model/workspaceFile.js';
	import ImportDialog from './ImportDialog.svelte';

	function entry(name: string, idps: number): BundleEntry {
		const workspace = newWorkspace(name);
		for (let i = 0; i < idps; i++) {
			const idp = newIdp(`IdP ${i + 1}`);
			const client = newClient();
			client.flows.push(newFlow('client_credentials'));
			idp.clients.push(client);
			workspace.idps.push(idp);
		}
		return { workspace, runs: [] };
	}

	const { Story } = defineMeta({
		title: 'Options/ImportDialog',
		component: ImportDialog,
		parameters: { layout: 'fullscreen' },
		args: {
			open: true,
			entries: [entry('Keycloak dev', 1), entry('Entra prod', 2)],
			hasSettings: false,
			onimport: fn()
		}
	});

	const body = () => within(document.querySelector('dialog')!);
</script>

<Story
	name="REQ-WS-013 lists every workspace checked with its counts and no settings checkbox"
	parameters={{ req: ['REQ-WS-013'] }}
	play={async () => {
		const dialog = body();
		await expect(dialog.getByRole('heading', { name: 'Import workspaces' })).toBeVisible();
		await expect(dialog.getByRole('checkbox', { name: /Keycloak dev/ })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: /Entra prod/ })).toBeChecked();
		await expect(dialog.getByText('1 IdP, 0 runs')).toBeVisible();
		await expect(dialog.getByText('2 IdPs, 0 runs')).toBeVisible();
		await expect(dialog.queryByRole('checkbox', { name: 'Apply settings from file' })).toBeNull();
		await expect(dialog.getByRole('button', { name: 'Import 2 workspaces' })).toBeEnabled();
	}}
/>

<Story
	name="REQ-WS-013 only checked workspaces are imported"
	parameters={{ req: ['REQ-WS-013'] }}
	play={async ({ userEvent, args }) => {
		const dialog = body();
		await userEvent.click(dialog.getByRole('checkbox', { name: /Keycloak dev/ }));
		await userEvent.click(dialog.getByRole('button', { name: 'Import 1 workspace' }));
		await expect(args.onimport).toHaveBeenCalledTimes(1);
		const [entries, apply] = (args.onimport as ReturnType<typeof fn>).mock.calls[0];
		await expect(entries.map((e: BundleEntry) => e.workspace.name)).toEqual(['Entra prod']);
		await expect(apply).toBe(false);
	}}
/>

<Story
	name="REQ-WS-013 apply settings checkbox appears unchecked when the file has settings"
	parameters={{ req: ['REQ-WS-013'] }}
	args={{ hasSettings: true }}
	play={async ({ userEvent, args }) => {
		const dialog = body();
		const apply = dialog.getByRole('checkbox', { name: 'Apply settings from file' });
		await expect(apply).not.toBeChecked();
		await userEvent.click(apply);
		await userEvent.click(dialog.getByRole('button', { name: 'Import 2 workspaces' }));
		const [, applied] = (args.onimport as ReturnType<typeof fn>).mock.calls[0];
		await expect(applied).toBe(true);
	}}
/>

<Story
	name="REQ-WS-013 confirm is disabled with nothing checked"
	parameters={{ req: ['REQ-WS-013'] }}
	play={async ({ userEvent }) => {
		const dialog = body();
		await userEvent.click(dialog.getByRole('checkbox', { name: /Keycloak dev/ }));
		await userEvent.click(dialog.getByRole('checkbox', { name: /Entra prod/ }));
		await expect(dialog.getByRole('button', { name: 'Import 0 workspaces' })).toBeDisabled();
	}}
/>
