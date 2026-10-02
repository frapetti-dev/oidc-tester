<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import SelectField from './SelectField.svelte';

	const { Story } = defineMeta({
		title: 'UI/SelectField',
		component: SelectField,
		args: {
			label: 'Client authentication',
			value: 'none',
			options: [
				{ value: 'none', label: 'None (public client)' },
				{ value: 'client_secret_basic', label: 'client_secret_basic' },
				{ value: 'client_secret_post', label: 'client_secret_post' }
			]
		}
	});
</script>

<Story
	name="Default"
	play={async ({ canvas, userEvent }) => {
		const select = canvas.getByLabelText('Client authentication');
		await expect(select).toHaveValue('none');
		await userEvent.selectOptions(select, 'client_secret_post');
		await expect(select).toHaveValue('client_secret_post');
	}}
/>

<Story
	name="Disabled"
	args={{ disabled: true }}
	play={async ({ canvas }) => {
		await expect(canvas.getByLabelText('Client authentication')).toBeDisabled();
	}}
/>
