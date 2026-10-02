<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import SecretField from './SecretField.svelte';

	const { Story } = defineMeta({
		title: 'UI/SecretField',
		component: SecretField,
		args: { label: 'Client secret', hasSecret: false, onsave: fn(), onclear: fn() }
	});
</script>

<Story
	name="No secret: masked, reveal, save on blur"
	play={async ({ canvas, userEvent, args }) => {
		const input = canvas.getByLabelText('Client secret');
		await expect(input).toHaveAttribute('type', 'password');
		await expect(canvas.queryByText(/stored in keychain/i)).toBeNull();
		await expect(canvas.queryByRole('button', { name: 'Clear' })).toBeNull();

		await userEvent.type(input, 's3cret');
		await userEvent.click(canvas.getByRole('button', { name: 'Show' }));
		await expect(input).toHaveAttribute('type', 'text');
		await expect(input).toHaveValue('s3cret');

		await userEvent.tab();
		await expect(args.onsave).toHaveBeenCalledTimes(1);
		await expect(args.onsave).toHaveBeenCalledWith('s3cret');
	}}
/>

<Story
	name="Stored in keychain"
	args={{ hasSecret: true }}
	play={async ({ canvas, userEvent, args }) => {
		await expect(canvas.getByText(/stored in keychain/i)).toBeVisible();
		await expect(canvas.getByLabelText('Client secret')).toHaveValue('');
		await userEvent.click(canvas.getByRole('button', { name: 'Clear' }));
		await expect(args.onclear).toHaveBeenCalledOnce();
	}}
/>

<Story
	name="Blur without typing saves nothing"
	play={async ({ canvas, userEvent, args }) => {
		await userEvent.click(canvas.getByLabelText('Client secret'));
		await userEvent.tab();
		await expect(args.onsave).not.toHaveBeenCalled();
	}}
/>
