<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import SplitPane from './SplitPane.svelte';

	const { Story } = defineMeta({
		title: 'UI/SplitPane',
		component: SplitPane,
		parameters: { layout: 'fullscreen' }
	});
</script>

{#snippet start()}
	<div class="p-3" data-testid="start">Start pane</div>
{/snippet}
{#snippet end()}
	<div class="p-3" data-testid="end">End pane</div>
{/snippet}

<Story
	name="Keyboard resize and limits"
	args={{ start, end, size: 200, min: 150, max: 260, label: 'Resize sidebar' }}
	play={async ({ canvas, userEvent }) => {
		const handle = canvas.getByRole('separator', { name: 'Resize sidebar' });
		await expect(handle).toHaveAttribute('aria-valuenow', '200');
		handle.focus();
		await userEvent.keyboard('{ArrowRight}');
		await expect(handle).toHaveAttribute('aria-valuenow', '216');
		await expect(canvas.getByTestId('start').parentElement!.getBoundingClientRect().width).toBe(
			216
		);
		await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
		await expect(handle).toHaveAttribute('aria-valuenow', '260');
		await userEvent.keyboard('{Home}');
		await expect(handle).toHaveAttribute('aria-valuenow', '150');
	}}
/>

<Story
	name="Pointer drag, end pane fixed"
	args={{ start, end, size: 200, fixed: 'end', min: 100, max: 400, label: 'Resize results' }}
	play={async ({ canvas, userEvent }) => {
		const handle = canvas.getByRole('separator', { name: 'Resize results' });
		const rect = handle.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		// Dragging the handle 50px left grows the fixed end pane by 50px.
		await userEvent.pointer([
			{ keys: '[MouseLeft>]', target: handle, coords: { clientX: x, clientY: y } },
			{ coords: { clientX: x - 50, clientY: y } },
			{ keys: '[/MouseLeft]' }
		]);
		await expect(handle).toHaveAttribute('aria-valuenow', '250');
	}}
/>
