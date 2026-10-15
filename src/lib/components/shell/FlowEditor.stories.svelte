<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import FlowEditor from './FlowEditor.svelte';

	const { Story } = defineMeta({
		title: 'Shell/FlowEditor',
		component: FlowEditor,
		parameters: { layout: 'fullscreen' }
	});
</script>

{#snippet fields()}
	<p>Editor fields go here</p>
{/snippet}

{#snippet runAction()}
	<button type="button">Run</button>
{/snippet}

<Story
	name="Empty state"
	play={async ({ canvas }) => {
		await expect(canvas.getByText('No flow selected')).toBeVisible();
	}}
/>

<Story
	name="With content"
	args={{ title: 'Auth code + PKCE', children: fields }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('heading', { name: 'Auth code + PKCE' })).toBeVisible();
		await expect(canvas.getByText('Editor fields go here')).toBeVisible();
		await expect(canvas.queryByText('No flow selected')).toBeNull();
	}}
/>

<Story
	name="REQ-UI-019 actions sit at the right end of the title row"
	parameters={{ req: ['REQ-UI-019'] }}
	args={{ title: 'Auth code + PKCE', children: fields, actions: runAction }}
	play={async ({ canvas }) => {
		const heading = canvas.getByRole('heading', { name: 'Auth code + PKCE' });
		const action = canvas.getByRole('button', { name: 'Run' });
		await expect(heading.parentElement).toBe(action.parentElement);
		await expect(action.getBoundingClientRect().left).toBeGreaterThan(
			heading.getBoundingClientRect().left
		);
		await expect(
			Math.abs(
				action.getBoundingClientRect().right - heading.parentElement!.getBoundingClientRect().right
			)
		).toBeLessThan(24);
	}}
/>
