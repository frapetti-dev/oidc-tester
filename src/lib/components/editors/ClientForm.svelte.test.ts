import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { newClient, type Client } from '#lib/model/schema.js';
import { createMemoryIpc, type MemoryIpc } from '#lib/testing/memoryIpc.js';
import { WorkspaceStore } from '#lib/state/workspace.svelte.js';
import { SECTIONS_STORAGE_KEY, resetSectionMemory } from '#lib/state/sections.svelte.js';
import ClientForm from './ClientForm.svelte';

let ipc: MemoryIpc;
let store: WorkspaceStore;
let client: Client;

beforeEach(async () => {
	localStorage.removeItem(SECTIONS_STORAGE_KEY);
	resetSectionMemory();
	ipc = createMemoryIpc();
	store = new WorkspaceStore(ipc);
	await store.init();
	store.addIdp();
	client = newClient();
	store.current!.idps[0].clients.push(client);
	client = store.current!.idps[0].clients[0];
});
afterEach(() => store.dispose());

async function mount() {
	return await render(ClientForm, { client, store });
}

describe('ClientForm', () => {
	it('REQ-SEC-002 client secret field only appears for secret methods and saves to the keychain', async () => {
		await mount();
		await expect.element(page.getByLabelText('Client secret')).not.toBeInTheDocument();
		await page.getByLabelText('Client authentication').selectOptions('client_secret_basic');
		const field = page.getByLabelText('Client secret');
		await field.fill('s3cret');
		await page.getByLabelText('Client ID').click();
		await vi.waitFor(() => expect(client.hasSecret).toBe(true));
		expect(ipc.secrets.get(`client:${client.id}:client_secret`)).toBe('s3cret');
		expect(JSON.stringify(client)).not.toContain('s3cret');
	});

	it('REQ-SEC-003 Clear removes the keychain entry', async () => {
		await store.setClientSecret(client, 'x');
		client.auth = 'client_secret_post';
		await mount();
		await page.getByRole('button', { name: 'Clear', exact: true }).click();
		await vi.waitFor(() => expect(client.hasSecret).toBe(false));
		expect(ipc.secrets.has(`client:${client.id}:client_secret`)).toBe(false);
	});

	it('REQ-HTTP-003 assertion algorithm only appears for client_secret_jwt', async () => {
		await mount();
		await expect.element(page.getByLabelText('Assertion algorithm')).not.toBeInTheDocument();
		await page.getByLabelText('Client authentication').selectOptions('client_secret_jwt');
		await page.getByLabelText('Assertion algorithm').selectOptions('HS384');
		expect(client.jwtAlg).toBe('HS384');
	});
});
