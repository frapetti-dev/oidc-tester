<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import { createMemoryIpc } from '#lib/testing/memoryIpc.js';
	import TimelinePanel from './TimelinePanel.svelte';
	import { sampleRun } from './fixtures';

	const run = sampleRun();
	const older = sampleRun('run-0', { status: 'error', startedAt: '2025-12-31T09:00:00.000Z' });

	const { Story } = defineMeta({
		title: 'Timeline/TimelinePanel',
		component: TimelinePanel,
		args: {
			ipc: createMemoryIpc(),
			run,
			runs: [run, older],
			onselectrun: () => {},
			ondeleterun: () => {},
			appVersion: '0.1.0'
		}
	});
</script>

<Story
	name="REQ-TL-001 Merged list with filter"
	parameters={{ req: ['REQ-TL-001'] }}
	play={async ({ canvas, userEvent }) => {
		const list = canvas.getByRole('list', { name: 'Timeline' });
		await expect(list.querySelectorAll('li')).toHaveLength(4);
		await userEvent.click(canvas.getByRole('button', { name: 'NAV' }));
		await expect(list.querySelectorAll('li')).toHaveLength(2);
	}}
/>

<Story
	name="REQ-TL-002 Entry detail"
	parameters={{ req: ['REQ-TL-002'] }}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: /POST/ }));
		await expect(canvas.getByRole('region', { name: 'Entry detail' })).toBeVisible();
		await expect(canvas.getByTestId('body-json')).toHaveTextContent('"access_token": "at"');
	}}
/>

<Story
	name="Empty"
	args={{ run: null, runs: [] }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('No requests yet')).toBeVisible();
	}}
/>
