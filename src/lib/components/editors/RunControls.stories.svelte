<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import RunControls from './RunControls.svelte';

	const { Story } = defineMeta({
		title: 'Editors/RunControls',
		component: RunControls,
		args: { running: false, onrun: fn(), oncancel: fn() }
	});
</script>

<Story
	name="REQ-UI-019 Run is a larger button with a play icon"
	parameters={{ req: ['REQ-UI-019'] }}
	play={async ({ canvas, args, userEvent }) => {
		const run = canvas.getByRole('button', { name: /^Run$/ });
		await expect(run.querySelector('svg')).not.toBeNull();
		await expect(parseFloat(getComputedStyle(run).height)).toBeGreaterThan(32);
		await expect(canvas.queryByRole('button', { name: 'Cancel' })).toBeNull();
		await userEvent.click(run);
		await expect(args.onrun).toHaveBeenCalledOnce();
	}}
/>

<Story
	name="REQ-UI-019 Running disables Run and shows Cancel"
	parameters={{ req: ['REQ-UI-019', 'REQ-FLOW-012'] }}
	args={{ running: true }}
	play={async ({ canvas, args, userEvent }) => {
		await expect(canvas.getByRole('button', { name: /Running/ })).toBeDisabled();
		await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
		await expect(args.oncancel).toHaveBeenCalledOnce();
	}}
/>
