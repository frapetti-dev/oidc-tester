import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { HttpExchange, HttpRequestSpec, HttpResult } from '#lib/ipc/types.js';
import { FLOW_TYPE_LABELS, newWorkspace, type FlowType } from '#lib/model/schema.js';
import { SECTIONS_STORAGE_KEY, resetSectionMemory } from '#lib/state/sections.svelte.js';
import { contextMenu } from '#lib/state/contextMenu.svelte.js';
import { createMemoryIpc, type MemoryIpc } from '#lib/testing/memoryIpc.js';
import '../../../app.css';
import AppRoot from './AppRoot.svelte';

function reply(spec: HttpRequestSpec, status: number, body: unknown): HttpResult {
	const exchange: HttpExchange = {
		id: crypto.randomUUID(),
		startedAt: new Date().toISOString(),
		durationMs: 5,
		request: { method: spec.method, url: spec.url, headers: spec.headers, body: spec.body },
		response: {
			status,
			statusText: '',
			httpVersion: 'HTTP/1.1',
			headers: [['content-type', 'application/json']],
			body: JSON.stringify(body),
			bodyBase64: null
		}
	};
	return { ok: true, exchange };
}

let ipc: MemoryIpc;

async function addFlow(type: FlowType) {
	await page.getByRole('button', { name: 'Add IdP' }).click();
	await page.getByLabelText('Token endpoint', { exact: true }).fill('https://idp.test/token');
	await page.getByRole('button', { name: 'Add client to New IdP' }).click();
	await page.getByLabelText('Client ID').fill('fake-client');
	await page.getByRole('button', { name: 'Add flow to New client' }).click();
	await page.getByRole('menuitem', { name: FLOW_TYPE_LABELS[type], exact: true }).click();
}

function rightClick(element: Element) {
	element.dispatchEvent(
		new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })
	);
}

afterEach(async () => {
	ipc = createMemoryIpc();
	await page.viewport(1280, 800);
	contextMenu.current = null;
	resetSectionMemory();
	localStorage.removeItem(SECTIONS_STORAGE_KEY);
});

describe('app', () => {
	it('REQ-UI-001 shows Sidebar, FlowEditor and a ResultsPanel with Tokens/Errors/Timeline tabs in three resizable panes', async () => {
		ipc = createMemoryIpc();
		await render(AppRoot, { ipc });

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

	it('REQ-FLOW-005 a client_credentials run from the UI shows the access token and persists the run', async () => {
		ipc = createMemoryIpc();
		ipc.onHttpSend = async (spec) =>
			reply(spec, 200, { access_token: 'opaque-access-token', token_type: 'Bearer' });
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();

		await addFlow('client_credentials');
		await page.getByRole('button', { name: 'Run', exact: true }).click();

		await expect.element(page.getByText('opaque-access-token').first()).toBeVisible();
		await expect
			.poll(() => [...ipc.docs.keys()].filter((k) => k.includes('/runs/')).length)
			.toBe(1);
	});

	it('REQ-ERR-003 a failed run switches to the Errors tab; a later success switches to Tokens', async () => {
		ipc = createMemoryIpc();
		let fail = true;
		ipc.onHttpSend = async (spec) =>
			fail
				? reply(spec, 400, { error: 'invalid_client', error_description: 'bad credentials' })
				: reply(spec, 200, { access_token: 'opaque-access-token', token_type: 'Bearer' });
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();

		await addFlow('client_credentials');
		await page.getByRole('button', { name: 'Run', exact: true }).click();
		await expect
			.element(page.getByRole('tab', { name: 'Errors' }))
			.toHaveAttribute('aria-selected', 'true');
		await expect.element(page.getByText('bad credentials')).toBeVisible();

		fail = false;
		await page.getByRole('button', { name: 'Run', exact: true }).click();
		await expect
			.element(page.getByRole('tab', { name: 'Tokens' }))
			.toHaveAttribute('aria-selected', 'true');
	});

	it("REQ-UI-020 switching flows shows each flow's last run or the empty state", async () => {
		ipc = createMemoryIpc();
		ipc.onHttpSend = async (spec) =>
			reply(spec, 200, { access_token: 'opaque-access-token', token_type: 'Bearer' });
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();

		await addFlow('client_credentials');
		await page.getByRole('button', { name: 'Run', exact: true }).click();
		await expect.element(page.getByText('opaque-access-token').first()).toBeVisible();

		await page.getByRole('button', { name: 'Add flow to New client' }).click();
		await page.getByRole('menuitem', { name: 'Device Code', exact: true }).click();
		await expect
			.element(page.getByRole('region', { name: 'Results' }).getByText('No run yet'))
			.toBeVisible();

		await page
			.getByRole('treeitem', { name: new RegExp(FLOW_TYPE_LABELS.client_credentials) })
			.click();
		await expect.element(page.getByText('opaque-access-token').first()).toBeVisible();
	});

	it('REQ-UI-008 the titlebar indicator shows success after a run and reverts to idle after 2400ms', async () => {
		ipc = createMemoryIpc();
		ipc.onHttpSend = async (spec) =>
			reply(spec, 200, { access_token: 'opaque-access-token', token_type: 'Bearer' });
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();
		const indicator = page.getByTestId('run-indicator');
		await expect.element(indicator).toHaveAttribute('data-state', 'idle');

		await addFlow('client_credentials');
		await page.getByRole('button', { name: 'Run', exact: true }).click();
		await expect.element(indicator).toHaveAttribute('data-state', 'success');
		await expect.element(indicator, { timeout: 4000 }).toHaveAttribute('data-state', 'idle');
	});

	it('REQ-UI-006 medium width stacks results under the editor', async () => {
		ipc = createMemoryIpc();
		await page.viewport(1000, 700);
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
		const separators = page.getByRole('separator').elements();
		expect(separators).toHaveLength(2);
		expect(separators.map((el) => el.getAttribute('aria-orientation')).sort()).toEqual([
			'horizontal',
			'vertical'
		]);
	});

	it('REQ-UI-006 narrow width moves the sidebar into a drawer', async () => {
		ipc = createMemoryIpc();
		await page.viewport(800, 600);
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('main', { name: 'Flow editor' })).toBeVisible();
		expect(page.getByRole('complementary', { name: 'Sidebar' }).query()).toBeNull();

		const toggle = page.getByRole('button', { name: 'Show sidebar' });
		await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
		await toggle.click();
		const drawer = page.getByRole('dialog', { name: 'Sidebar navigation' });
		await expect.element(drawer.getByRole('button', { name: 'Add IdP' })).toBeVisible();
		await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');

		await userEvent.keyboard('{Escape}');
		await expect.element(drawer).not.toBeInTheDocument();

		await toggle.click();
		await drawer.getByRole('button', { name: 'Add IdP' }).click();
		await drawer.getByRole('button', { name: 'New IdP', exact: true }).click();
		await expect.element(drawer).not.toBeInTheDocument();
	});

	it('REQ-UI-016 client row opens the Client tab with Client ID; IdP tab has none; flow row shows the flow form', async () => {
		ipc = createMemoryIpc();
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();
		await addFlow('client_credentials');

		await page.getByRole('button', { name: 'New client', exact: true }).click();
		await expect
			.element(page.getByRole('tab', { name: 'Client' }))
			.toHaveAttribute('aria-selected', 'true');
		await expect.element(page.getByLabelText('Client ID')).toBeVisible();

		await page.getByRole('button', { name: 'New IdP', exact: true }).click();
		await expect
			.element(page.getByRole('tab', { name: 'IdP' }))
			.toHaveAttribute('aria-selected', 'true');
		await expect.element(page.getByLabelText('Token endpoint', { exact: true })).toBeVisible();
		await expect.element(page.getByLabelText('Client ID')).not.toBeInTheDocument();

		await page.getByRole('treeitem').first().click();
		await expect
			.element(page.getByRole('tab', { name: 'Flow' }))
			.toHaveAttribute('aria-selected', 'true');
		await expect.element(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
	});

	it('REQ-UI-019 Run sits at the right end of the title row on the Flow tab only', async () => {
		ipc = createMemoryIpc();
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();
		await addFlow('client_credentials');

		const editor = page.getByRole('main', { name: 'Flow editor' });
		const heading = editor.getByRole('heading').element();
		const run = editor.getByRole('button', { name: 'Run', exact: true }).element();
		expect(run.parentElement!.parentElement).toBe(heading.parentElement);
		expect(run.querySelector('svg')).not.toBeNull();
		expect(run.getBoundingClientRect().height).toBeGreaterThan(32);
		const row = heading.parentElement!.getBoundingClientRect();
		expect(run.getBoundingClientRect().left).toBeGreaterThan(heading.getBoundingClientRect().left);
		expect(row.right - run.getBoundingClientRect().right).toBeLessThan(24);

		await page.getByRole('tab', { name: 'Client' }).click();
		await expect
			.element(editor.getByRole('button', { name: 'Run', exact: true }))
			.not.toBeInTheDocument();
	});

	it('REQ-UI-011 IdP menu renames and adds flows', async () => {
		ipc = createMemoryIpc();
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();
		await page.getByRole('button', { name: 'Add IdP' }).click();

		const row = page.getByRole('button', { name: 'New IdP', exact: true });
		await expect.element(row).toBeVisible();
		rightClick(row.element());
		await expect.element(page.getByRole('menuitem').first()).toBeVisible();
		const items = page
			.getByRole('menuitem')
			.elements()
			.map((el) => el.textContent?.trim());
		expect(items).toEqual(['Add client', 'Duplicate', 'Rename…', 'Delete…']);
		await page.getByRole('menuitem', { name: 'Rename…' }).click();

		const dialog = page.getByRole('dialog', { name: 'Rename IdP' });
		await dialog.getByLabelText('Name').fill('Renamed IdP');
		await dialog.getByRole('button', { name: 'Rename' }).click();
		await expect
			.element(page.getByRole('button', { name: 'Renamed IdP', exact: true }))
			.toBeVisible();
	});

	it('REQ-UI-017 + buttons create a client and a typed flow without a confirmation dialog', async () => {
		ipc = createMemoryIpc();
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();
		await page.getByRole('button', { name: 'Add IdP' }).click();

		await page.getByRole('button', { name: 'Add client to New IdP' }).click();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'New client', exact: true }))
			.toBeVisible();
		await expect
			.element(page.getByRole('tab', { name: 'Client' }))
			.toHaveAttribute('aria-selected', 'true');

		await page.getByRole('button', { name: 'Add flow to New client' }).click();
		const labels = page
			.getByRole('menuitem')
			.elements()
			.map((el) => el.textContent?.trim());
		expect(labels).toEqual(Object.values(FLOW_TYPE_LABELS));
		await page.getByRole('menuitem', { name: 'Device Code', exact: true }).click();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
		await expect.element(page.getByRole('treeitem', { name: /Device Code/ })).toBeVisible();
		await expect
			.element(page.getByRole('tab', { name: 'Flow' }))
			.toHaveAttribute('aria-selected', 'true');
	});

	it('REQ-UI-019 Run stays in view while the flow form scrolls', async () => {
		ipc = createMemoryIpc();
		await page.viewport(1280, 420);
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();
		await addFlow('authorization_code_pkce');

		const panel = page.getByRole('main', { name: 'Flow editor' }).getByRole('tabpanel');
		const scroller = panel.element() as HTMLElement;
		await expect.poll(() => scroller.scrollHeight > scroller.clientHeight).toBe(true);
		const run = page.getByRole('button', { name: 'Run', exact: true });
		scroller.scrollTop = scroller.scrollHeight;
		await expect.element(run).toBeInViewport();
		scroller.scrollTop = 0;
		await expect.element(run).toBeInViewport();
	});
	it('REQ-UI-024 Options menu opens Settings and About', async () => {
		ipc = createMemoryIpc();
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('radio', { name: 'Dark' })).not.toBeInTheDocument();

		await page.getByRole('button', { name: 'Options' }).click();
		const items = page
			.getByRole('menu', { name: 'Options' })
			.getByRole('menuitem')
			.elements()
			.map((el) => el.textContent?.trim());
		expect(items).toEqual(['Export…', 'Import…', 'Settings…', 'About OIDC Tester']);
		await page.getByRole('menuitem', { name: 'Settings…' }).click();
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await expect.element(settings).toBeVisible();
		await settings.getByText('Dark', { exact: true }).click();
		await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(true);
		await settings.getByText('System', { exact: true }).click();
		await settings.getByRole('button', { name: 'Done' }).click();
		await expect.element(settings).not.toBeInTheDocument();

		await page.getByRole('button', { name: 'Options' }).click();
		await page.getByRole('menuitem', { name: 'About OIDC Tester' }).click();
		const about = page.getByRole('dialog', { name: 'About' });
		await expect.element(about.getByText('Version 0.1.0')).toBeVisible();
		await expect.element(about.getByText('131.0.0.0')).toBeVisible();
	});

	it('REQ-WS-012 exporting two workspaces without runs writes one bundle and toasts the path', async () => {
		ipc = createMemoryIpc();
		const second = newWorkspace('Second');
		ipc.docs.set(`workspaces/${second.id}/workspace.json`, second);
		ipc.savePath = 'C:/out/two.oidcbundle.json';
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();

		await page.getByRole('button', { name: 'Options' }).click();
		await page.getByRole('menuitem', { name: 'Export…' }).click();
		const dialog = page.getByRole('dialog', { name: 'Export workspaces' });
		await expect.element(dialog.getByRole('checkbox', { name: /Scratchpad/ })).toBeChecked();
		await expect.element(dialog.getByRole('checkbox', { name: /Second/ })).not.toBeChecked();
		await dialog.getByRole('checkbox', { name: /Second/ }).click();
		await dialog.getByRole('button', { name: 'Export 2 workspaces' }).click();

		await expect
			.element(
				page.getByRole('status').getByText('Exported 2 workspaces to C:/out/two.oidcbundle.json')
			)
			.toBeVisible();
		const file = JSON.parse(ipc.files.get('C:/out/two.oidcbundle.json') ?? '');
		expect(file.format).toBe('oidc-tester-bundle');
		expect(file.workspaces).toHaveLength(2);
		expect(file.workspaces.every((w: { runs: unknown[] }) => w.runs.length === 0)).toBe(true);
		expect(file.settings).toBeUndefined();
	});

	it('REQ-WS-013 importing a bundle adds the checked workspaces and opens the first', async () => {
		ipc = createMemoryIpc();
		const bundle = {
			format: 'oidc-tester-bundle',
			version: 1,
			exportedAt: '2026-01-01T00:00:00.000Z',
			workspaces: [
				{ workspace: newWorkspace('Alpha'), runs: [] },
				{ workspace: newWorkspace('Beta'), runs: [] }
			]
		};
		ipc.files.set('C:/in/two.oidcbundle.json', JSON.stringify(bundle));
		ipc.openPath = 'C:/in/two.oidcbundle.json';
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();

		await page.getByRole('button', { name: 'Options' }).click();
		await page.getByRole('menuitem', { name: 'Import…' }).click();
		const dialog = page.getByRole('dialog', { name: 'Import workspaces' });
		await expect.element(dialog.getByRole('checkbox', { name: /Alpha/ })).toBeChecked();
		await dialog.getByRole('checkbox', { name: /Beta/ }).click();
		await dialog.getByRole('button', { name: 'Import 1 workspace' }).click();

		await expect.element(page.getByText('Imported 1 workspace')).toBeVisible();
		const select = page.getByLabelText('Workspace', { exact: true });
		await expect
			.poll(() => (select.element() as HTMLSelectElement).selectedOptions[0]?.textContent)
			.toBe('Alpha');
		expect(page.getByRole('option', { name: 'Beta' }).elements()).toHaveLength(0);
	});

	it('REQ-SET-002 REQ-SET-003 new IdP and flow take their defaults from Settings', async () => {
		ipc = createMemoryIpc();
		await render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();

		await page.getByRole('button', { name: 'Options' }).click();
		await page.getByRole('menuitem', { name: 'Settings…' }).click();
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await settings.getByLabelText('Timeout (ms)').fill('5000');
		await settings.getByLabelText('Redirect URI').fill('https://spoofed.invalid/cb');
		await settings.getByRole('button', { name: 'Done' }).click();
		await expect.element(settings).not.toBeInTheDocument();

		await addFlow('authorization_code_pkce');
		const editor = page.getByRole('main', { name: 'Flow editor' });
		await expect
			.element(editor.getByLabelText('Redirect URI'))
			.toHaveValue('https://spoofed.invalid/cb');

		await page.getByRole('button', { name: 'New IdP', exact: true }).click();
		await editor.getByRole('button', { name: /Network/ }).click();
		await expect.element(editor.getByLabelText('Timeout (ms)')).toHaveValue(5000);
		await expect
			.poll(() => ipc.docs.get('settings.json'))
			.toMatchObject({ newFlow: { redirectUri: 'https://spoofed.invalid/cb' } });
	});
});
