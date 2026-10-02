<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import CodeView from './CodeView.svelte';

	const { Story } = defineMeta({
		title: 'UI/CodeView',
		component: CodeView
	});
</script>

<Story
	name="Compact JSON string is pretty-printed"
	args={{ value: '{"iss":"http://localhost:4455","aud":["a","b"],"exp":1}' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('code').textContent).toBe(
			'{\n  "iss": "http://localhost:4455",\n  "aud": [\n    "a",\n    "b"\n  ],\n  "exp": 1\n}'
		);
	}}
/>

<Story
	name="Object value"
	args={{ value: { alg: 'RS256', typ: 'JWT' } }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('code').textContent).toBe(
			'{\n  "alg": "RS256",\n  "typ": "JWT"\n}'
		);
	}}
/>

<Story
	name="Non-JSON text stays verbatim"
	args={{ value: '<html>502 Bad Gateway</html>' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('code').textContent).toBe('<html>502 Bad Gateway</html>');
	}}
/>

<Story
	name="Copy button puts the displayed text on the clipboard"
	args={{ value: '{"a":1}' }}
	play={async ({ canvas, userEvent }) => {
		// Headless Chromium denies clipboard access, so observe what is written instead.
		const writeText = fn(async () => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		try {
			await userEvent.click(canvas.getByRole('button', { name: 'Copy' }));
			await expect(writeText).toHaveBeenCalledTimes(1);
			await expect(writeText).toHaveBeenCalledWith('{\n  "a": 1\n}');
			await expect(canvas.getByRole('button', { name: 'Copied' })).toBeVisible();
		} finally {
			Reflect.deleteProperty(navigator, 'clipboard');
		}
	}}
/>
