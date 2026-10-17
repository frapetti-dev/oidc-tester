<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor, within } from 'storybook/test';
	import licenseData from '#lib/about/licenses.json';
	import ContextMenuHost from '#lib/components/ui/ContextMenuHost.svelte';
	import AboutDialog from './AboutDialog.svelte';

	const INFO = {
		version: '0.1.0',
		tauriVersion: '2.12.1',
		webviewVersion: '131.0.0.0',
		os: 'Windows 10.0.26300 (64-bit)',
		dataDir: 'C:\\Users\\test\\AppData\\Roaming\\dev.oidctester.app'
	};

	const { Story } = defineMeta({
		title: 'Options/AboutDialog',
		component: AboutDialog,
		parameters: { layout: 'fullscreen' },
		args: { open: true, info: INFO, onopenurl: fn() }
	});

	const body = () => within(document.querySelector('dialog')!);
</script>

{#snippet template(args: {
	open: boolean;
	info: typeof INFO | null;
	onopenurl: (u: string) => void;
})}
	<AboutDialog {...args} />
	<ContextMenuHost />
{/snippet}

<Story
	name="REQ-UI-025 shows name, versions and the collapsed license sections"
	parameters={{ req: ['REQ-UI-025'] }}
	{template}
	play={async () => {
		const dialog = body();
		await expect(dialog.getByText('OIDC Tester', { selector: 'p' })).toBeVisible();
		await expect(dialog.getByText('Version 0.1.0')).toBeVisible();
		await expect(dialog.getByText('2.12.1', { selector: 'dd' })).toBeVisible();
		await expect(dialog.getByText('131.0.0.0', { selector: 'dd' })).toBeVisible();
		await expect(dialog.getByText('Windows 10.0.26300 (64-bit)', { selector: 'dd' })).toBeVisible();
		const license = dialog.getByText('License', { selector: 'summary' }).closest('details')!;
		await expect(license.open).toBe(false);
		const third = dialog
			.getByText(`Third-party licenses (${licenseData.packages.length})`)
			.closest('details')!;
		await expect(third.open).toBe(false);
		await expect(license.textContent).toContain('Permission is hereby granted');
	}}
/>

<Story
	name="REQ-UI-025 source code and issues buttons open the repository URLs"
	parameters={{ req: ['REQ-UI-025'] }}
	{template}
	play={async ({ userEvent, args }) => {
		const dialog = body();
		await userEvent.click(dialog.getByRole('button', { name: 'Source code' }));
		await userEvent.click(dialog.getByRole('button', { name: 'Report an issue' }));
		await expect(args.onopenurl).toHaveBeenNthCalledWith(
			1,
			'https://git.infinityreply.dev/f.rapetti/oidc-tester'
		);
		await expect(args.onopenurl).toHaveBeenNthCalledWith(
			2,
			'https://git.infinityreply.dev/f.rapetti/oidc-tester/-/issues'
		);
	}}
/>

<Story
	name="REQ-UI-025 filtering the third-party list narrows the rows case-insensitively"
	parameters={{ req: ['REQ-UI-025'] }}
	{template}
	play={async ({ userEvent }) => {
		const dialog = body();
		const details = dialog
			.getByText(/^Third-party licenses/, { selector: 'summary' })
			.closest('details')!;
		await userEvent.click(dialog.getByText(/^Third-party licenses/, { selector: 'summary' }));
		await expect(details.open).toBe(true);
		const rows = () => details.querySelectorAll('li').length;
		await expect(rows()).toBe(licenseData.packages.length);
		await userEvent.type(dialog.getByLabelText('Filter packages'), 'TAURI');
		await waitFor(() => expect(rows()).toBeLessThan(licenseData.packages.length));
		const expected = licenseData.packages.filter((p) => p.name.toLowerCase().includes('tauri'));
		await expect(rows()).toBe(expected.length);
		await userEvent.clear(dialog.getByLabelText('Filter packages'));
		await userEvent.type(dialog.getByLabelText('Filter packages'), 'zzz-no-such-package');
		await expect(dialog.getByText('No packages match.')).toBeVisible();
	}}
/>

<Story
	name="REQ-UI-026 Copy diagnostics copies the five lines and shows Copied"
	parameters={{ req: ['REQ-UI-026'] }}
	{template}
	play={async ({ userEvent }) => {
		const writes: string[] = [];
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: async (text: string) => void writes.push(text) }
		});
		await userEvent.click(body().getByRole('button', { name: 'Copy diagnostics' }));
		await expect(writes).toEqual([
			[
				'OIDC Tester 0.1.0',
				'Tauri 2.12.1',
				'WebView2 131.0.0.0',
				'OS Windows 10.0.26300 (64-bit)',
				'Data folder C:\\Users\\test\\AppData\\Roaming\\dev.oidctester.app'
			].join('\n')
		]);
		await waitFor(() => expect(within(document.body).getByText('Copied')).toBeVisible());
	}}
/>

<Story
	name="REQ-UI-025 Copy diagnostics is disabled until the host info arrived"
	parameters={{ req: ['REQ-UI-025'] }}
	args={{ info: null }}
	{template}
	play={async () => {
		await expect(body().getByRole('button', { name: 'Copy diagnostics' })).toBeDisabled();
	}}
/>
