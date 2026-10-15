<script module lang="ts">
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import EmptyState from './EmptyState.svelte';

	const { Story } = defineMeta({
		title: 'UI/EmptyState',
		component: EmptyState,
		args: { icon: KeyRound, title: 'No run yet' }
	});
</script>

<Story
	name="With description"
	args={{ description: 'Run a flow to inspect its tokens here.' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('No run yet')).toBeVisible();
		await expect(canvas.getByText('Run a flow to inspect its tokens here.')).toBeVisible();
	}}
/>
<Story name="Title only" />
