import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('app shell', () => {
	it('REQ-UI-001 shows Sidebar, FlowEditor and a ResultsPanel with Tokens/Errors/Timeline tabs in three resizable panes', async () => {
		render(Page);

		await expect.element(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
		await expect.element(page.getByRole('main', { name: 'Flow editor' })).toBeVisible();
		const results = page.getByRole('region', { name: 'Results' });
		await expect.element(results).toBeVisible();
		for (const name of ['Tokens', 'Errors', 'Timeline']) {
			await expect.element(results.getByRole('tab', { name })).toBeVisible();
		}
		await expect.element(results.getByText('No run yet')).toBeVisible();

		// Two separators: sidebar|editor and editor|results.
		expect(page.getByRole('separator').elements()).toHaveLength(2);
	});
});
