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
