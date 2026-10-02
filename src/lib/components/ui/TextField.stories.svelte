<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import TextField from './TextField.svelte';

	const { Story } = defineMeta({
		title: 'UI/TextField',
		component: TextField,
		args: { label: 'Client ID' }
	});
</script>

<Story
	name="Default"
	args={{ placeholder: 'my-client' }}
	play={async ({ canvas, userEvent }) => {
		const input = canvas.getByLabelText('Client ID');
		await userEvent.type(input, 'public-spa');
		await expect(input).toHaveValue('public-spa');
	}}
/>

<Story
	name="With hint and suggestions"
	args={{ label: 'Scope', hint: 'Space separated', list: 'scopes', value: 'openid' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByLabelText('Scope')).toHaveAttribute('list', 'scopes');
		await expect(canvas.getByText('Space separated')).toBeVisible();
	}}
/>

<Story
	name="Error"
	args={{ label: 'Issuer', value: 'not a url', error: 'Must be an absolute URL' }}
	play={async ({ canvas }) => {
		const input = canvas.getByLabelText('Issuer');
		await expect(input).toHaveAttribute('aria-invalid', 'true');
		await expect(canvas.getByText('Must be an absolute URL')).toBeVisible();
	}}
/>

<Story
	name="Monospace and disabled"
	args={{ label: 'Code verifier', value: 'abc123', mono: true, disabled: true }}
	play={async ({ canvas }) => {
		await expect(canvas.getByLabelText('Code verifier')).toBeDisabled();
	}}
/>
