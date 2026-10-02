import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { HttpExchange, HttpRequestSpec, HttpResult } from '$lib/ipc/types';
import type { Idp } from '$lib/model/schema';
import { createMemoryIpc, type MemoryIpc } from '$lib/testing/memoryIpc';
import { WorkspaceStore } from '$lib/state/workspace.svelte';
import IdpForm, { type DiscoveryOutcome } from './IdpForm.svelte';

const ISSUER = 'https://idp.example/realm';

function respond(spec: HttpRequestSpec, status: number, body: string): HttpResult {
	const exchange: HttpExchange = {
		id: crypto.randomUUID(),
		startedAt: '2026-01-01T00:00:00Z',
		durationMs: 1,
		request: { method: spec.method, url: spec.url, headers: spec.headers, body: spec.body },
		response: {
			status,
			statusText: '',
			httpVersion: 'HTTP/1.1',
			headers: [],
			body,
			bodyBase64: null
		}
	};
	return { ok: true, exchange };
}

const document = (over: Record<string, unknown> = {}) =>
	JSON.stringify({
		issuer: ISSUER,
		authorization_endpoint: `${ISSUER}/authorize`,
		token_endpoint: `${ISSUER}/token`,
		jwks_uri: `${ISSUER}/jwks`,
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		...over
	});

let ipc: MemoryIpc;
let store: WorkspaceStore;
let idp: Idp;
let results: DiscoveryOutcome[];
let cleared: number;

beforeEach(async () => {
	ipc = createMemoryIpc();
	store = new WorkspaceStore(ipc);
	await store.init();
	store.addIdp();
	idp = store.current!.idps[0];
	idp.issuer = ISSUER;
	results = [];
	cleared = 0;
});
afterEach(() => store.dispose());

function mount() {
	return render(IdpForm, {
		idp,
		store,
		ipc,
		onDiscoveryResult: (r: DiscoveryOutcome) => results.push(r),
		onclearsession: () => cleared++
	});
}

describe('IdpForm', () => {
	it('REQ-DISC-003 Discover fills only empty endpoints; Apply all overwrites after confirmation', async () => {
		ipc.onHttpSend = async (spec) => respond(spec, 200, document());
		idp.endpoints.token = 'https://custom.example/token';
		mount();

		await page.getByRole('button', { name: 'Discover' }).click();
		await expect
			.element(page.getByRole('textbox', { name: 'Authorization endpoint', exact: true }))
			.toHaveValue(`${ISSUER}/authorize`);
		expect(idp.endpoints.token).toBe('https://custom.example/token');
		expect(idp.discoveredAt).not.toBeNull();
		expect(results).toEqual([{ error: null, exchanges: expect.any(Array) }]);
		await expect.element(page.getByText('Code challenge methods')).toBeVisible();

		await page.getByRole('button', { name: 'Apply all' }).click();
		expect(idp.endpoints.token).toBe('https://custom.example/token');
		await page.getByRole('button', { name: 'Confirm overwrite' }).click();
		expect(idp.endpoints.token).toBe(`${ISSUER}/token`);
	});

	it('REQ-DISC-004 shows the issuer mismatch warning', async () => {
		ipc.onHttpSend = async (spec) =>
			respond(spec, 200, document({ issuer: 'https://other.example' }));
		mount();
		await page.getByRole('button', { name: 'Discover' }).click();
		await expect.element(page.getByRole('status')).toHaveTextContent(/issuer/i);
	});

	it('REQ-DISC-006 reports a discovery failure to the parent and leaves endpoints untouched', async () => {
		ipc.onHttpSend = async (spec) => respond(spec, 500, 'boom');
		mount();
		await page.getByRole('button', { name: 'Discover' }).click();
		await expect.element(page.getByRole('alert')).toBeVisible();
		await vi.waitFor(() => expect(results).toHaveLength(1));
		expect(results[0].error).not.toBeNull();
		expect(results[0].exchanges.length).toBeGreaterThan(0);
		expect(idp.endpoints.authorization).toBe('');
	});

	it('REQ-UI-004 skip-TLS toggle shows the danger badge and updates settings', async () => {
		mount();
		await expect.element(page.getByText('TLS validation disabled')).not.toBeInTheDocument();
		await page.getByRole('switch', { name: 'Skip TLS validation' }).click();
		expect(idp.http.tlsInsecure).toBe(true);
		await expect.element(page.getByText('TLS validation disabled')).toBeVisible();
	});

	it('REQ-SEC-002 client secret field only appears for secret methods and saves to the keychain', async () => {
		mount();
		await expect.element(page.getByLabelText('Client secret')).not.toBeInTheDocument();
		await page.getByLabelText('Client authentication').selectOptions('client_secret_basic');
		const field = page.getByLabelText('Client secret');
		await field.fill('s3cret');
		await page.getByLabelText('Client ID').click();
		await vi.waitFor(() => expect(idp.client.hasSecret).toBe(true));
		expect(ipc.secrets.get(`idp:${idp.id}:client_secret`)).toBe('s3cret');
		expect(JSON.stringify(idp)).not.toContain('s3cret');
	});

	it('REQ-SEC-003 Clear removes the keychain entry', async () => {
		await store.setClientSecret(idp, 'x');
		idp.client.auth = 'client_secret_post';
		mount();
		await page.getByRole('button', { name: 'Clear', exact: true }).click();
		await vi.waitFor(() => expect(idp.client.hasSecret).toBe(false));
		expect(ipc.secrets.has(`idp:${idp.id}:client_secret`)).toBe(false);
	});

	it('REQ-HTTP-003 edits proxy, timeout, origin, CORS check and headers; jwt alg only for client_secret_jwt', async () => {
		mount();
		await expect.element(page.getByLabelText('Assertion algorithm')).not.toBeInTheDocument();
		await page.getByLabelText('Client authentication').selectOptions('client_secret_jwt');
		await page.getByLabelText('Assertion algorithm').selectOptions('HS384');
		expect(idp.client.jwtAlg).toBe('HS384');

		await expect.element(page.getByLabelText('Proxy URL')).not.toBeInTheDocument();
		await page.getByLabelText('Proxy', { exact: true }).selectOptions('url');
		await page.getByLabelText('Proxy URL').fill('http://proxy.local:8080');
		await page.getByLabelText('Timeout (ms)').fill('1500');
		await page.getByLabelText('Origin').fill('https://app.example');
		await page.getByRole('switch', { name: 'Check CORS for this origin' }).click();
		await page.getByRole('button', { name: 'Add header' }).click();
		await page.getByLabelText('Name 1').fill('X-Test');

		expect(idp.http.proxy).toEqual({ mode: 'url', url: 'http://proxy.local:8080' });
		expect(idp.http.timeoutMs).toBe(1500);
		expect(idp.http.origin).toBe('https://app.example');
		expect(idp.http.corsCheck).toBe(true);
		expect(idp.http.headers[0].name).toBe('X-Test');
	});

	it('REQ-CAP-005 Clear browser session button notifies the parent', async () => {
		mount();
		await page.getByRole('button', { name: 'Clear browser session' }).click();
		expect(cleared).toBe(1);
	});
});
