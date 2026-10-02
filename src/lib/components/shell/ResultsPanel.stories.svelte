<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import ResultsPanel from './ResultsPanel.svelte';

	const { Story } = defineMeta({
		title: 'Shell/ResultsPanel',
		component: ResultsPanel,
		parameters: { layout: 'fullscreen' }
	});
</script>

{#snippet errors()}
	<p>invalid_grant</p>
{/snippet}

<Story
	name="REQ-UI-005 Empty states"
	parameters={{ req: ['REQ-UI-005'] }}
	play={async ({ canvas, userEvent }) => {
		await expect(canvas.getByRole('tab', { name: 'Tokens' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(canvas.getByText('No run yet')).toBeVisible();
		await userEvent.click(canvas.getByRole('tab', { name: 'Errors' }));
		await expect(canvas.getByText('No errors')).toBeVisible();
		await userEvent.click(canvas.getByRole('tab', { name: 'Timeline' }));
		await expect(canvas.getByText('No requests yet')).toBeVisible();
	}}
/>

<Story
	name="Provided content replaces the empty state"
	args={{ active: 'errors', errors }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('invalid_grant')).toBeVisible();
		await expect(canvas.queryByText('No errors')).toBeNull();
	}}
/>
