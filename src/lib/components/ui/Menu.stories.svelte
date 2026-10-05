<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import Menu from './Menu.svelte';

	const { Story } = defineMeta({
		title: 'UI/Menu',
		component: Menu,
		parameters: { req: ['REQ-UI-009'] },
		args: { at: { x: 40, y: 40 }, label: 'Demo menu', onclose: fn() }
	});

	const onC = fn();
</script>

<Story
	name="REQ-UI-009 keyboard navigation skips disabled items and Escape closes"
	args={{
		items: [
			{ label: 'A', onselect: fn() },
			{ label: 'B', onselect: fn(), disabled: true },
			{ label: 'C', onselect: onC }
		]
	}}
	play={async ({ canvas, userEvent, args }) => {
		const menu = await canvas.findByRole('menu', { name: 'Demo menu' });
		await waitFor(() => expect(canvas.getByRole('menuitem', { name: 'A' })).toHaveFocus());
		await userEvent.keyboard('{ArrowDown}');
		await expect(canvas.getByRole('menuitem', { name: 'C' })).toHaveFocus();
		await userEvent.keyboard('{ArrowDown}');
		await expect(canvas.getByRole('menuitem', { name: 'A' })).toHaveFocus();
		await userEvent.keyboard('{End}');
		await expect(canvas.getByRole('menuitem', { name: 'C' })).toHaveFocus();
		await userEvent.keyboard('{Enter}');
		await expect(onC).toHaveBeenCalledTimes(1);
		await expect(args.onclose).toHaveBeenCalledTimes(1);
		menu.focus();
		await userEvent.keyboard('{Escape}');
		await expect(args.onclose).toHaveBeenCalledTimes(2);
	}}
/>
