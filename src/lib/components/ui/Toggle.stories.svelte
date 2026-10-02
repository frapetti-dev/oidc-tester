<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import Toggle from './Toggle.svelte';

	const { Story } = defineMeta({
		title: 'UI/Toggle',
		component: Toggle,
		args: { label: 'Use PKCE' }
	});
</script>

<Story
	name="Off then on"
	play={async ({ canvas, userEvent }) => {
		const toggle = canvas.getByRole('switch', { name: 'Use PKCE' });
		await expect(toggle).not.toBeChecked();
		await userEvent.click(toggle);
		await expect(toggle).toBeChecked();
		await userEvent.keyboard(' ');
		await expect(toggle).not.toBeChecked();
	}}
/>

<Story
	name="On"
	args={{ checked: true }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('switch', { name: 'Use PKCE' })).toBeChecked();
	}}
/>

<Story
	name="Disabled"
	args={{ disabled: true }}
	play={async ({ canvas, userEvent }) => {
		const toggle = canvas.getByRole('switch', { name: 'Use PKCE' });
		await userEvent.click(toggle);
		await expect(toggle).not.toBeChecked();
	}}
/>
