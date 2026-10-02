<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import Button from './Button.svelte';

	const { Story } = defineMeta({
		title: 'UI/Button',
		component: Button,
		args: { onclick: fn() }
	});
</script>

<Story
	name="Default"
	play={async ({ canvas, userEvent, args }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Run flow' }));
		await expect(args.onclick).toHaveBeenCalledOnce();
	}}
>
	Run flow
</Story>

<Story
	name="Primary"
	args={{ variant: 'primary' }}
	play={async ({ canvas }) => {
		const button = canvas.getByRole('button', { name: 'Run' });
		// btn-primary must win the cascade over the base btn background.
		const probe = document.createElement('div');
		probe.style.backgroundColor = 'var(--c-accent)';
		document.body.append(probe);
		await expect(getComputedStyle(button).backgroundColor).toBe(
			getComputedStyle(probe).backgroundColor
		);
		probe.remove();
	}}
>
	Run
</Story>

<Story name="Ghost" args={{ variant: 'ghost' }}>Cancel</Story>

<Story name="Danger" args={{ variant: 'danger' }}>Delete</Story>

<Story
	name="Disabled"
	args={{ disabled: true }}
	play={async ({ canvas, userEvent, args }) => {
		const button = canvas.getByRole('button', { name: 'Running…' });
		await expect(button).toBeDisabled();
		await userEvent.click(button);
		await expect(args.onclick).not.toHaveBeenCalled();
	}}
>
	Running…
</Story>
