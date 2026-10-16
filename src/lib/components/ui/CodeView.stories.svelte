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
	name="REQ-UI-023 Non-JSON text stays verbatim"
	parameters={{ req: ['REQ-UI-023'] }}
	args={{ value: '<html>502 Bad Gateway</html>' }}
	play={async ({ canvas }) => {
		const code = canvas.getByTestId('code');
		await expect(code.textContent).toBe('<html>502 Bad Gateway</html>');
		await expect(code.querySelector('[data-token]')).toBeNull();
	}}
/>

<Story
	name="REQ-UI-023 JSON is syntax highlighted"
	parameters={{ req: ['REQ-UI-023'] }}
	args={{ value: '{"iss":"x","exp":1,"ok":true}' }}
	play={async ({ canvas }) => {
		const code = canvas.getByTestId('code');
		const key = code.querySelector('[data-token="key"]')!;
		await expect(key.textContent).toBe('"iss"');
		await expect(code.querySelector('[data-token="string"]')?.textContent).toBe('"x"');
		await expect(code.querySelector('[data-token="number"]')?.textContent).toBe('1');
		await expect(code.querySelector('[data-token="literal"]')?.textContent).toBe('true');
		await expect(getComputedStyle(key).color).not.toBe(getComputedStyle(code).color);
		await expect(code.textContent).toBe('{\n  "iss": "x",\n  "exp": 1,\n  "ok": true\n}');
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
