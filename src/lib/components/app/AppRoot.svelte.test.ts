import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { HttpExchange, HttpRequestSpec, HttpResult } from '$lib/ipc/types';
import { createMemoryIpc, type MemoryIpc } from '$lib/testing/memoryIpc';
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

async function addClientCredentialsFlow() {
	await page.getByRole('button', { name: 'Add IdP' }).click();
	await page.getByLabelText('Client ID').fill('fake-client');
	await page.getByLabelText('Token endpoint', { exact: true }).fill('https://idp.test/token');
	await page.getByRole('button', { name: /Add flow to/ }).click();
	await page.getByLabelText('Flow type').selectOptions('client_credentials');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
}

afterEach(() => {
	ipc = createMemoryIpc();
});

describe('app', () => {
	it('REQ-UI-001 shows Sidebar, FlowEditor and a ResultsPanel with Tokens/Errors/Timeline tabs in three resizable panes', async () => {
		ipc = createMemoryIpc();
		render(AppRoot, { ipc });

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
		render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();

		await addClientCredentialsFlow();
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
		render(AppRoot, { ipc });
		await expect.element(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();

		await addClientCredentialsFlow();
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
});
