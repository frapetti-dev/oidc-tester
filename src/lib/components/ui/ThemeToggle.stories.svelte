<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import ThemeToggle from './ThemeToggle.svelte';

	const { Story } = defineMeta({
		title: 'UI/ThemeToggle',
		component: ThemeToggle,
		parameters: { req: ['REQ-UI-002'] }
	});

	const isDark = () => document.documentElement.classList.contains('dark');
</script>

<Story
	name="REQ-UI-002 System, Light, Dark"
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('radio', { name: 'Dark' }));
		await expect(isDark()).toBe(true);
		await expect(localStorage.getItem('oidct.theme')).toBe('dark');
		await expect(canvas.getByRole('radio', { name: 'Dark' })).toBeChecked();

		await userEvent.click(canvas.getByRole('radio', { name: 'Light' }));
		await expect(isDark()).toBe(false);
		await expect(localStorage.getItem('oidct.theme')).toBe('light');

		await userEvent.click(canvas.getByRole('radio', { name: 'System' }));
		await expect(localStorage.getItem('oidct.theme')).toBe('system');
		await expect(isDark()).toBe(matchMedia('(prefers-color-scheme: dark)').matches);
	}}
/>

<Story
	name="REQ-UI-022 selected option uses accent"
	parameters={{ req: ['REQ-UI-022'] }}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('radio', { name: 'Dark' }));
		const label = canvas.getByRole('radio', { name: 'Dark' }).closest('label')!;
		const probe = document.createElement('div');
		probe.style.color = 'var(--c-accent)';
		document.body.append(probe);
		await expect(getComputedStyle(label).color).toBe(getComputedStyle(probe).color);
		probe.remove();
		await userEvent.click(canvas.getByRole('radio', { name: 'System' }));
	}}
/>
