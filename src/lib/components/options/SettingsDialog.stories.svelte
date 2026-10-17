<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, within } from 'storybook/test';
	import { SETTINGS_DOC } from '#lib/model/settings.js';
	import { SettingsStore } from '#lib/state/settings.svelte.js';
	import { createMemoryIpc } from '#lib/testing/memoryIpc.js';
	import SettingsDialog from './SettingsDialog.svelte';

	const DATA_DIR = 'C:\\Users\\test\\AppData\\Roaming\\dev.oidctester.app';

	function fresh() {
		const ipc = createMemoryIpc();
		return { ipc, settings: new SettingsStore(ipc) };
	}
	const ctx = fresh();
	const reset = () => void Object.assign(ctx, fresh());

	const { Story } = defineMeta({
		title: 'Options/SettingsDialog',
		component: SettingsDialog,
		parameters: { layout: 'fullscreen' },
		args: {
			open: true,
			dataDir: DATA_DIR,
			onreveal: fn(),
			onclearsession: fn()
		}
	});

	const body = () => within(document.querySelector('dialog')!);
</script>

{#snippet template(args: {
	open: boolean;
	dataDir: string;
	onreveal: () => void;
	onclearsession: () => void;
})}
	<SettingsDialog {...args} settings={ctx.settings} />
{/snippet}

<Story
	name="REQ-SET-001 an edit is written to settings.json"
	parameters={{ req: ['REQ-SET-001'] }}
	beforeEach={() => {
		reset();
	}}
	{template}
	play={async ({ userEvent }) => {
		const dialog = body();
		await expect(dialog.getByLabelText('Redirect URI')).toHaveValue(
			'http://localhost:8080/callback'
		);
		await expect(dialog.getByLabelText('Timeout (ms)')).toHaveValue(30000);
		await expect(dialog.getByLabelText('Runs kept per workspace')).toHaveValue(200);
		const redirect = dialog.getByLabelText('Redirect URI');
		await userEvent.clear(redirect);
		await userEvent.type(redirect, 'https://spoofed.invalid/cb');
		await ctx.settings.flush();
		await expect(ctx.ipc.docs.get(SETTINGS_DOC)).toMatchObject({
			newFlow: { redirectUri: 'https://spoofed.invalid/cb' }
		});
	}}
/>

<Story
	name="REQ-SET-001 invalid numbers show an error and are not saved"
	parameters={{ req: ['REQ-SET-001'] }}
	beforeEach={() => {
		reset();
	}}
	{template}
	play={async ({ userEvent }) => {
		const dialog = body();
		const timeout = dialog.getByLabelText('Timeout (ms)');
		await userEvent.clear(timeout);
		await userEvent.type(timeout, '0');
		await expect(dialog.getByText('Enter a whole number above 0')).toBeVisible();
		await expect(ctx.settings.current.newIdp.timeoutMs).toBe(30000);
		await userEvent.clear(timeout);
		await userEvent.type(timeout, '5000');
		await expect(ctx.settings.current.newIdp.timeoutMs).toBe(5000);

		const limit = dialog.getByLabelText('Runs kept per workspace');
		await userEvent.clear(limit);
		await userEvent.type(limit, '-1');
		await expect(dialog.getByText('Enter 0 or a whole number')).toBeVisible();
		await userEvent.clear(limit);
		await userEvent.type(limit, '0');
		await expect(ctx.settings.current.runHistoryLimit).toBe(0);
	}}
/>

<Story
	name="REQ-SET-002 proxy mode url reveals the proxy URL field and TLS toggle applies"
	parameters={{ req: ['REQ-SET-002'] }}
	beforeEach={() => {
		reset();
	}}
	{template}
	play={async ({ userEvent }) => {
		const dialog = body();
		await expect(dialog.queryByLabelText('Proxy URL')).toBeNull();
		await userEvent.selectOptions(dialog.getByLabelText('Proxy'), 'url');
		await userEvent.type(dialog.getByLabelText('Proxy URL'), 'http://proxy:3128');
		await userEvent.click(dialog.getByRole('switch', { name: 'Skip TLS validation' }));
		await expect(ctx.settings.current.newIdp).toMatchObject({
			proxy: { mode: 'url', url: 'http://proxy:3128' },
			tlsInsecure: true
		});
	}}
/>

<Story
	name="REQ-SET-005 data folder and session buttons call their handlers"
	parameters={{ req: ['REQ-SET-005'] }}
	beforeEach={() => {
		reset();
	}}
	{template}
	play={async ({ userEvent, args }) => {
		const dialog = body();
		const path = dialog.getByText(DATA_DIR);
		await expect(path).toBeVisible();
		await expect(getComputedStyle(path).fontFamily).toMatch(/mono/i);
		await userEvent.click(dialog.getByRole('button', { name: 'Show in Explorer' }));
		await userEvent.click(dialog.getByRole('button', { name: 'Clear auth browser session' }));
		await expect(args.onreveal).toHaveBeenCalledTimes(1);
		await expect(args.onclearsession).toHaveBeenCalledTimes(1);
	}}
/>

<Story
	name="REQ-UI-002 appearance section holds the labeled theme control"
	parameters={{ req: ['REQ-UI-002'] }}
	beforeEach={() => {
		reset();
	}}
	{template}
	play={async () => {
		const dialog = body();
		for (const name of ['System', 'Light', 'Dark']) {
			await expect(dialog.getByRole('radio', { name })).toBeVisible();
		}
	}}
/>
