<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import { newFlow, newIdp } from '#lib/model/schema.js';
	import { createMemoryIpc } from '#lib/testing/memoryIpc.js';
	import { WorkspaceStore } from '#lib/state/workspace.svelte.js';
	import FlowForm from './FlowForm.svelte';

	const ipc = createMemoryIpc();
	const idp = newIdp('Demo');
	idp.issuer = 'https://idp.example';
	idp.endpoints.authorization = 'https://idp.example/authorize';
	idp.client.clientId = 'demo-client';

	const { Story } = defineMeta({
		title: 'Editors/FlowForm',
		component: FlowForm,
		args: {
			idp,
			flow: newFlow('authorization_code_pkce'),
			store: new WorkspaceStore(ipc),
			ipc,
			runs: [],
			running: false,
			deviceCode: null,
			onrun: fn(),
			oncancel: fn()
		}
	});
</script>

<Story
	name="PKCE flow shows verifier and authorize preview"
	play={async ({ canvas, args, userEvent }) => {
		await expect(await canvas.findByLabelText('Code verifier')).toBeVisible();
		await expect(await canvas.findByTestId('authorize-preview')).toHaveTextContent(
			'code_challenge_method=S256'
		);
		await userEvent.click(canvas.getByRole('button', { name: 'Run' }));
		await expect(args.onrun).toHaveBeenCalledOnce();
	}}
/>

<Story
	name="Running shows Cancel and disables Run"
	args={{ running: true, flow: newFlow('client_credentials') }}
	play={async ({ canvas, args, userEvent }) => {
		await expect(canvas.getByRole('button', { name: /Running/ })).toBeDisabled();
		await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
		await expect(args.oncancel).toHaveBeenCalledOnce();
	}}
/>

<Story
	name="Device flow shows the user code"
	args={{
		flow: newFlow('device_code'),
		deviceCode: {
			userCode: 'WDJB-MJHT',
			verificationUri: 'https://idp.example/device',
			expiresAt: Date.now() + 600_000,
			interval: 5
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('user-code')).toHaveTextContent('WDJB-MJHT');
	}}
/>
