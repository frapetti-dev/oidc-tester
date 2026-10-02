<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import type { KV } from '$lib/model/schema';
	import KeyValueEditor from './KeyValueEditor.svelte';

	const { Story } = defineMeta({
		title: 'UI/KeyValueEditor',
		component: KeyValueEditor
	});
</script>

<script lang="ts">
	let empty = $state<KV[]>([]);
	let filled = $state<KV[]>([
		{ name: 'X-Tenant', value: 'acme', enabled: true },
		{ name: 'X-Debug', value: '1', enabled: false }
	]);
</script>

<Story
	name="Empty then add row"
	asChild
	play={async ({ canvas, userEvent }) => {
		await expect(canvas.getByText('No entries')).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Add header' }));
		await userEvent.type(canvas.getByLabelText('Name 1'), 'X-Trace');
		await userEvent.type(canvas.getByLabelText('Value 1'), 'abc');
		await expect(canvas.getByTestId('state')).toHaveTextContent(
			'[{"name":"X-Trace","value":"abc","enabled":true}]'
		);
	}}
>
	<KeyValueEditor bind:rows={empty} label="Headers" addLabel="Add header" />
	<pre data-testid="state" class="mt-2 font-mono text-xs text-fg-muted">{JSON.stringify(
			empty
		)}</pre>
</Story>

<Story
	name="Toggle and remove rows"
	asChild
	play={async ({ canvas, userEvent }) => {
		await expect(canvas.getByLabelText('Enabled 2')).not.toBeChecked();
		await userEvent.click(canvas.getByLabelText('Enabled 2'));
		await expect(canvas.getByTestId('state')).toHaveTextContent(
			'"name":"X-Debug","value":"1","enabled":true'
		);
		await userEvent.click(canvas.getByRole('button', { name: 'Remove 1' }));
		await expect(canvas.queryByDisplayValue('X-Tenant')).toBeNull();
		await expect(canvas.getByDisplayValue('X-Debug')).toBeVisible();
	}}
>
	<KeyValueEditor bind:rows={filled} label="Headers" addLabel="Add header" />
	<pre data-testid="state" class="mt-2 font-mono text-xs text-fg-muted">{JSON.stringify(
			filled
		)}</pre>
</Story>
