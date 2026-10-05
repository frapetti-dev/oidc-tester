import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createMemoryIpc } from '#lib/testing/memoryIpc.js';
import TimelinePanel from './TimelinePanel.svelte';
import ContextMenuHost from '#lib/components/ui/ContextMenuHost.svelte';
import { contextMenu } from '#lib/state/contextMenu.svelte.js';
import { sampleRun } from './fixtures';

afterEach(() => (contextMenu.current = null));

function rightClick(element: Element) {
	element.dispatchEvent(
		new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })
	);
}

async function setup(overrides: { savePath?: string | null } = {}) {
	await render(ContextMenuHost);
	const ipc = createMemoryIpc();
	ipc.savePath = overrides.savePath === undefined ? 'C:/out/run.har' : overrides.savePath;
	const run = sampleRun();
	const onselectrun = vi.fn();
	const ondeleterun = vi.fn();
	await render(TimelinePanel, {
		ipc,
		run,
		runs: [run],
		onselectrun,
		ondeleterun,
		appVersion: '1.2.3'
	});
	return { ipc, run, onselectrun, ondeleterun };
}

describe('TimelinePanel', () => {
	it('REQ-TL-001 lists navigations and exchanges chronologically and filters by type', async () => {
		await setup();
		const list = page.getByRole('list', { name: 'Timeline' });
		const items = list.getByRole('listitem');
		await expect.element(items.nth(0)).toMatchTextContent('openid-configuration');
		await expect.element(items.nth(1)).toMatchTextContent('NAV');
		await expect.element(items.nth(3)).toMatchTextContent('POST');
		await expect.element(items.nth(3)).toMatchTextContent('200');
		await expect.element(items.nth(3)).toMatchTextContent('42 ms');

		await page.getByRole('button', { name: 'NAV', exact: true }).click();
		expect(list.getByRole('listitem').elements()).toHaveLength(2);
		await page.getByRole('button', { name: 'HTTP', exact: true }).click();
		expect(list.getByRole('listitem').elements()).toHaveLength(2);
		await expect.element(list.getByRole('listitem').first()).not.toMatchTextContent('NAV');
	});

	it('REQ-TL-002 shows headers, pretty JSON and form table for the clicked entry', async () => {
		await setup();
		await page.getByRole('button', { name: /POST/ }).click();
		const detail = page.getByRole('region', { name: 'Entry detail' });
		await expect.element(detail.getByText('grant_type')).toBeVisible();
		await expect.element(detail.getByText('authorization_code')).toBeVisible();
		await expect
			.element(detail.getByTestId('body-json'))
			.toMatchTextContent('"access_token": "at"');
		await expect.element(detail.getByText('application/json')).toBeVisible();
	});

	it('REQ-TL-005 saves the HAR via save dialog and write_text_file', async () => {
		const { ipc } = await setup();
		const pick = vi.spyOn(ipc, 'pickSavePath');
		await page.getByRole('button', { name: 'Save HAR' }).click();
		await vi.waitFor(() => expect(ipc.files.has('C:/out/run.har')).toBe(true));
		const opts = pick.mock.calls[0][0];
		expect(opts.defaultPath).toMatch(/^PKCE flow-.+\.har$/);
		expect(opts.filters).toEqual([{ name: 'HAR', extensions: ['har'] }]);
		const har = JSON.parse(ipc.files.get('C:/out/run.har') ?? '');
		expect(har.log.version).toBe('1.2');
		expect(har.log.entries).toHaveLength(2);
	});

	it('REQ-TL-005 writes nothing when the dialog is cancelled', async () => {
		const { ipc } = await setup({ savePath: null });
		const pick = vi.spyOn(ipc, 'pickSavePath');
		await page.getByRole('button', { name: 'Save HAR' }).click();
		await vi.waitFor(() => expect(pick).toHaveBeenCalled());
		expect(ipc.files.size).toBe(0);
	});

	it('REQ-TL-006 history rows open and delete runs', async () => {
		const { onselectrun, ondeleterun } = await setup();
		await page.getByRole('button', { name: /^Open run/ }).click();
		await page.getByRole('button', { name: /^Delete run/ }).click();
		expect(onselectrun).toHaveBeenCalledWith('run-1');
		expect(ondeleterun).toHaveBeenCalledWith('run-1');
	});

	it('REQ-UI-013 history row menu opens and deletes runs', async () => {
		const { onselectrun, ondeleterun, run } = await setup();
		const row = page.getByText(run.flowSnapshot.name).last().element().closest('li')!;
		rightClick(row);
		const items = page.getByRole('menuitem');
		await expect.element(items.first()).toBeVisible();
		expect(items.elements().map((el) => el.textContent?.trim())).toEqual(['Open', 'Delete']);
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		expect(ondeleterun).toHaveBeenCalledWith('run-1');
		expect(onselectrun).not.toHaveBeenCalled();
	});

	it('REQ-UI-013 entry menus differ for HTTP and navigation entries and gate the response body', async () => {
		const { ipc } = await setup();
		const list = page.getByRole('list', { name: 'Timeline' });

		rightClick(list.getByRole('button', { name: /NAV/ }).first().element());
		await expect.element(page.getByRole('menuitem').first()).toBeVisible();
		expect(
			page
				.getByRole('menuitem')
				.elements()
				.map((el) => el.textContent?.trim())
		).toEqual(['Copy URL', 'Save HAR…']);
		await page.getByRole('menuitem', { name: 'Save HAR…' }).click();
		await vi.waitFor(() => expect(ipc.files.has('C:/out/run.har')).toBe(true));

		rightClick(list.getByRole('button', { name: /POST/ }).element());
		await expect.element(page.getByRole('menuitem', { name: 'Copy as cURL' })).toBeVisible();
		expect(
			page
				.getByRole('menuitem')
				.elements()
				.map((el) => el.textContent?.trim())
		).toEqual(['Copy URL', 'Copy as cURL', 'Copy response body', 'Save HAR…']);
		await expect.element(page.getByRole('menuitem', { name: 'Copy response body' })).toBeEnabled();
	});
});
