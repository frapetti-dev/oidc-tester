<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import ErrorsPanel from './ErrorsPanel.svelte';

	const { Story } = defineMeta({
		title: 'Results/ErrorsPanel',
		component: ErrorsPanel
	});
</script>

<Story
	name="Empty state"
	args={{ error: null }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('No errors')).toBeVisible();
	}}
/>

<Story
	name="REQ-ERR-001 Every field is rendered and the error URI opens through openLink"
	parameters={{ req: ['REQ-ERR-001'] }}
	args={{
		error: {
			source: 'token',
			error: 'invalid_grant',
			error_description: 'Code has expired',
			error_uri: 'https://idp.example/docs/errors#invalid_grant',
			httpStatus: 400,
			detail: '{"error":"invalid_grant","error_description":"Code has expired"}'
		},
		openLink: fn()
	}}
	play={async ({ canvas, userEvent, args }) => {
		await expect(canvas.getByTestId('error-source')).toHaveTextContent('token');
		await expect(canvas.getByTestId('error-code')).toHaveTextContent('invalid_grant');
		await expect(canvas.getByTestId('error-description')).toHaveTextContent('Code has expired');
		await expect(canvas.getByTestId('error-status')).toHaveTextContent('HTTP 400');
		await expect(canvas.getByTestId('code').textContent).toBe(
			'{\n  "error": "invalid_grant",\n  "error_description": "Code has expired"\n}'
		);
		await userEvent.click(
			canvas.getByRole('button', { name: 'https://idp.example/docs/errors#invalid_grant' })
		);
		await expect(args.openLink).toHaveBeenCalledTimes(1);
		await expect(args.openLink).toHaveBeenCalledWith(
			'https://idp.example/docs/errors#invalid_grant'
		);
	}}
/>

<Story
	name="REQ-ERR-001 Absent fields are not rendered"
	parameters={{ req: ['REQ-ERR-001'] }}
	args={{ error: { source: 'validation', error: 'state_mismatch' } }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('error-source')).toHaveTextContent('validation');
		await expect(canvas.getByTestId('error-code')).toHaveTextContent('state_mismatch');
		await expect(canvas.queryByTestId('error-description')).toBeNull();
		await expect(canvas.queryByTestId('error-uri')).toBeNull();
		await expect(canvas.queryByTestId('error-status')).toBeNull();
		await expect(canvas.queryByTestId('code')).toBeNull();
	}}
/>

<Story
	name="REQ-ERR-002 TLS failure shows the skip-validation hint"
	parameters={{ req: ['REQ-ERR-002'] }}
	args={{
		error: { source: 'tls', error: 'tls', detail: 'invalid peer certificate: UnknownIssuer' }
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('error-hint')).toHaveTextContent(
			"Certificate validation failed — enable 'Skip TLS validation' on the IdP to ignore"
		);
	}}
/>

<Story
	name="REQ-ERR-002 Known code shows a hint"
	parameters={{ req: ['REQ-ERR-002'] }}
	args={{ error: { source: 'token', error: 'invalid_client', httpStatus: 401 } }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('error-hint')).not.toBeEmptyDOMElement();
	}}
/>

<Story
	name="REQ-ERR-002 Unknown error code shows no hint"
	parameters={{ req: ['REQ-ERR-002'] }}
	args={{ error: { source: 'token', error: 'vendor_specific_failure' } }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('error-code')).toHaveTextContent('vendor_specific_failure');
		await expect(canvas.queryByTestId('error-hint')).toBeNull();
	}}
/>

<Story
	name="Non-ok validations are listed, ok ones hidden"
	args={{
		error: null,
		validations: [
			{ id: 'idt.iss', level: 'ok', message: 'iss matches the issuer' },
			{ id: 'idt.nonce', level: 'error', message: 'nonce mismatch' },
			{ id: 'sig.id_token', level: 'warn', message: 'No key to verify the signature' }
		]
	}}
	play={async ({ canvas }) => {
		await expect(canvas.queryByText('No errors')).toBeNull();
		await expect(canvas.getByText('nonce mismatch')).toBeVisible();
		await expect(canvas.getByText('No key to verify the signature')).toBeVisible();
		await expect(canvas.queryByText('iss matches the issuer')).toBeNull();
	}}
/>
