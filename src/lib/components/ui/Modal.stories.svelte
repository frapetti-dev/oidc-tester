<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import Button from './Button.svelte';
	import Modal from './Modal.svelte';

	const { Story } = defineMeta({
		title: 'UI/Modal',
		component: Modal,
		parameters: { layout: 'fullscreen' },
		args: { open: true, title: 'Example', size: 'sm' }
	});

	const dialogEl = () => document.querySelector('dialog')!;

	async function expectWidth(rem: number) {
		const dialog = dialogEl();
		await expect(dialog).toHaveAttribute('open');
		const px = parseFloat(getComputedStyle(document.documentElement).fontSize) * rem;
		await expect(Math.round(dialog.getBoundingClientRect().width)).toBe(Math.round(px));
	}
</script>

{#snippet frame(args: { open: boolean; title: string; size?: 'sm' | 'md' | 'lg' })}
	<Modal {...args}>
		<p class="text-sm">Body text</p>
		{#snippet aside()}Left note{/snippet}
		{#snippet footer()}
			<Button>Cancel</Button>
			<Button type="submit" variant="primary">Done</Button>
		{/snippet}
	</Modal>
{/snippet}

<Story name="Size sm is 26rem" args={{ size: 'sm' }} play={() => expectWidth(26)}>
	{#snippet template(args)}
		{@render frame(args)}
	{/snippet}
</Story>

<Story name="Size md is 34rem" args={{ size: 'md' }} play={() => expectWidth(34)}>
	{#snippet template(args)}
		{@render frame(args)}
	{/snippet}
</Story>

<Story name="Size lg is 44rem" args={{ size: 'lg' }} play={() => expectWidth(44)}>
	{#snippet template(args)}
		{@render frame(args)}
	{/snippet}
</Story>

<Story
	name="Footer puts the aside left and actions right"
	play={async ({ userEvent }) => {
		const dialog = dialogEl();
		const aside = dialog.querySelector('div.text-fg-muted')!;
		const done = [...dialog.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Done'
		)!;
		await expect(aside.textContent).toBe('Left note');
		await expect(aside.getBoundingClientRect().left).toBeLessThan(
			done.getBoundingClientRect().left
		);
		await userEvent.click(done);
		await expect(dialog.open).toBe(false);
	}}
>
	{#snippet template(args)}
		{@render frame(args)}
	{/snippet}
</Story>
