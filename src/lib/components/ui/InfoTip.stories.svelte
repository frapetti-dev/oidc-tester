<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor } from 'storybook/test';
	import InfoTip from './InfoTip.svelte';

	const { Story } = defineMeta({
		title: 'UI/InfoTip',
		component: InfoTip,
		parameters: { req: ['REQ-JWT-003'] }
	});
</script>

<Story
	name="REQ-JWT-003 tooltip opens on hover and focus, closes on Escape and leave"
	args={{ label: 'About iss', text: 'Issuer: identifies the party that issued the token' }}
	play={async ({ canvas, userEvent }) => {
		const button = canvas.getByRole('button', { name: 'About iss' });
		const tip = canvas.getByRole('tooltip', { hidden: true });
		await expect(tip).not.toBeVisible();
		await userEvent.hover(button);
		await expect(tip).toBeVisible();
		await expect(tip).toHaveTextContent('Issuer: identifies the party that issued the token');
		await userEvent.unhover(button);
		await waitFor(() => expect(tip).not.toBeVisible());
		button.focus();
		await waitFor(() => expect(tip).toBeVisible());
		await userEvent.keyboard('{Escape}');
		await waitFor(() => expect(tip).not.toBeVisible());
		await expect(button).toHaveAttribute('aria-describedby', tip.id);
	}}
/>
