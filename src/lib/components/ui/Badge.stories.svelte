<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import Badge from './Badge.svelte';
	import TlsInsecureToggle from './TlsInsecureToggle.svelte';

	const { Story } = defineMeta({
		title: 'UI/Badge',
		component: Badge
	});
</script>

<Story name="Neutral">POST</Story>
<Story name="Success" args={{ variant: 'success' }}>valid</Story>
<Story name="Danger" args={{ variant: 'danger' }}>invalid</Story>
<Story name="Warning" args={{ variant: 'warning' }}>expired</Story>

<Story
	name="REQ-UI-004 TLS-insecure warning badge"
	asChild
	parameters={{ req: ['REQ-UI-004'] }}
	play={async ({ canvas, userEvent }) => {
		const toggle = canvas.getByRole('switch', { name: 'Skip TLS validation' });
		await expect(canvas.queryByText('TLS validation disabled')).toBeNull();

		await userEvent.click(toggle);
		const badge = canvas.getByText('TLS validation disabled');
		await expect(badge).toBeVisible();
		await expect(badge).toHaveClass('badge-danger');

		await userEvent.click(toggle);
		await expect(canvas.queryByText('TLS validation disabled')).toBeNull();
	}}
>
	<TlsInsecureToggle />
</Story>
