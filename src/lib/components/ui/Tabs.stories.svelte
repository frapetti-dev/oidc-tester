<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import Tabs from './Tabs.svelte';

	const { Story } = defineMeta({
		title: 'UI/Tabs',
		component: Tabs,
		args: {
			label: 'Results',
			tabs: [
				{ id: 'tokens', label: 'Tokens' },
				{ id: 'errors', label: 'Errors' },
				{ id: 'timeline', label: 'Timeline' }
			]
		}
	});
</script>

{#snippet panel(id: string)}
	<p class="p-3">Content of {id}</p>
{/snippet}

<Story
	name="Select tabs"
	args={{ panel }}
	play={async ({ canvas, userEvent }) => {
		await expect(canvas.getByRole('tab', { name: 'Tokens' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Content of tokens');
		await userEvent.click(canvas.getByRole('tab', { name: 'Timeline' }));
		await expect(canvas.getByRole('tab', { name: 'Timeline' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Content of timeline');
	}}
/>

<Story
	name="Keyboard arrows"
	args={{ panel }}
	play={async ({ canvas, userEvent }) => {
		canvas.getByRole('tab', { name: 'Tokens' }).focus();
		await userEvent.keyboard('{ArrowRight}');
		await expect(canvas.getByRole('tab', { name: 'Errors' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
		await expect(canvas.getByRole('tab', { name: 'Timeline' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
	}}
/>

<Story
	name="REQ-UI-022 active tab underline uses accent"
	parameters={{ req: ['REQ-UI-022'] }}
	args={{ panel }}
	play={async ({ canvas }) => {
		const tab = canvas.getByRole('tab', { selected: true });
		const probe = document.createElement('div');
		probe.style.backgroundColor = 'var(--c-accent)';
		document.body.append(probe);
		await expect(getComputedStyle(tab).borderBottomColor).toBe(
			getComputedStyle(probe).backgroundColor
		);
		probe.remove();
	}}
/>
