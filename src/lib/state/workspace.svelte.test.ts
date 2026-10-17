import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createMemoryIpc, type MemoryIpc } from '#lib/testing/memoryIpc.js';
import { newSettings } from '#lib/model/settings.js';
import { WorkspaceStore } from './workspace.svelte';

let ipc: MemoryIpc;
let store: WorkspaceStore;

beforeEach(() => {
	ipc = createMemoryIpc();
	store = new WorkspaceStore(ipc);
});
afterEach(() => {
	store.dispose();
	vi.useRealTimers();
});

describe('WorkspaceStore', () => {
	it('REQ-WS-001 init creates and opens the scratchpad', async () => {
		await store.init();
		expect(store.current).toMatchObject({ id: 'scratchpad', name: 'Scratchpad', idps: [] });
		expect(ipc.docs.has('workspaces/scratchpad/workspace.json')).toBe(true);
	});

	it('REQ-WS-002 a change is written once, 500 ms after the last edit', async () => {
		await store.init();
		vi.useFakeTimers();
		const writes = vi.spyOn(ipc, 'docWrite');
		store.addIdp();
		flushSync();
		await vi.advanceTimersByTimeAsync(300);
		store.current!.idps[0].name = 'Renamed';
		flushSync();
		await vi.advanceTimersByTimeAsync(499);
		expect(writes).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(writes).toHaveBeenCalledTimes(1);
		const saved = ipc.docs.get('workspaces/scratchpad/workspace.json') as {
			idps: { name: string }[];
		};
		expect(saved.idps[0].name).toBe('Renamed');
	});

	it('REQ-WS-006 an invalid file shows the banner and is never overwritten', async () => {
		const bad = { schemaVersion: 1, id: 'broken', name: 7, idps: [] };
		ipc.docs.set('workspaces/broken/workspace.json', bad);
		await store.init();
		vi.useFakeTimers();
		await store.open('broken');
		expect(store.banner).toMatch(/^Workspace file is invalid: /);
		flushSync();
		await vi.advanceTimersByTimeAsync(2000);
		expect(ipc.docs.get('workspaces/broken/workspace.json')).toEqual(bad);
	});

	it('REQ-SEC-002 secret values go to the keychain; the workspace JSON only gets the flag; failures keep it false', async () => {
		await store.init();
		const idp = store.addIdp()!;
		const client = store.addClient(idp.id)!;
		await store.setClientSecret(client, 's3cret');
		expect(client.hasSecret).toBe(true);
		expect(ipc.secrets.get(`client:${client.id}:client_secret`)).toBe('s3cret');

		ipc.failSecretSet = 'denied';
		const flow = store.addFlow(idp.id, client.id, 'password')!;
		await store.setFlowPassword(flow, 'pw');
		expect(flow.params.hasPassword).toBe(false);
		expect(store.toast).toBe('Could not store secret in OS keychain: denied');
		expect(JSON.stringify($state.snapshot(store.current))).not.toContain('s3cret');
	});

	it('REQ-SEC-003 clearing a client secret deletes the entry and resets the flag', async () => {
		await store.init();
		const idp = store.addIdp()!;
		const client = store.addClient(idp.id)!;
		await store.setClientSecret(client, 's3cret');
		await store.clearClientSecret(client);
		expect(ipc.secrets.size).toBe(0);
		expect(client.hasSecret).toBe(false);
	});

	it('REQ-WS-003 saveAs opens the new workspace and leaves an empty scratchpad', async () => {
		await store.init();
		store.addIdp();
		await store.saveAs('Saved');
		expect(store.current?.name).toBe('Saved');
		expect(store.current?.idps).toHaveLength(1);
		expect(store.workspaces.map((w) => w.name)).toEqual(['Scratchpad', 'Saved']);
		await store.open('scratchpad');
		expect(store.current?.idps).toEqual([]);
	});

	it("REQ-WS-010 selecting an IdP selects its first client and that client's first flow", async () => {
		await store.init();
		const idp = store.addIdp()!;
		const first = store.addClient(idp.id)!;
		const flow = store.addFlow(idp.id, first.id, 'client_credentials')!;
		const second = store.addClient(idp.id)!;
		store.addFlow(idp.id, second.id, 'password');
		store.selectIdp(idp.id);
		expect(store.selection).toEqual({ idpId: idp.id, clientId: first.id, flowId: flow.id });
	});

	it("REQ-WS-010 selecting a client selects that client's first flow", async () => {
		await store.init();
		const idp = store.addIdp()!;
		const first = store.addClient(idp.id)!;
		store.addFlow(idp.id, first.id, 'client_credentials');
		const second = store.addClient(idp.id)!;
		const flow = store.addFlow(idp.id, second.id, 'password')!;
		store.addFlow(idp.id, second.id, 'device_code');
		store.selectClient(idp.id, second.id);
		expect(store.selection).toEqual({ idpId: idp.id, clientId: second.id, flowId: flow.id });
	});

	it('REQ-WS-010 deleting a client clears its client secret and flow password from the keychain', async () => {
		await store.init();
		const idpId = store.addIdp()!.id;
		const clientId = store.addClient(idpId)!.id;
		store.addFlow(idpId, clientId, 'password');
		// Re-read through the store: only reactive proxies carry the flags deleteClient relies on.
		const idp = store.current!.idps[0];
		await store.setClientSecret(idp.clients[0], 's3cret');
		await store.setFlowPassword(idp.clients[0].flows[0], 'pw');
		expect(ipc.secrets.size).toBe(2);
		await store.deleteClient(idpId, clientId);
		expect(ipc.secrets.size).toBe(0);
		expect(idp.clients).toEqual([]);
	});
});

describe('WorkspaceStore with settings', () => {
	it('REQ-SET-002 new IdPs copy timeout, proxy and TLS from settings; duplicates stay as they were', async () => {
		const settings = newSettings();
		settings.newIdp = {
			timeoutMs: 5000,
			proxy: { mode: 'url', url: 'http://p:1' },
			tlsInsecure: true
		};
		const withSettings = new WorkspaceStore(ipc, () => settings);
		await withSettings.init();
		const first = withSettings.addIdp()!;
		expect(first.http).toMatchObject({
			timeoutMs: 5000,
			proxy: { mode: 'url', url: 'http://p:1' },
			tlsInsecure: true
		});
		settings.newIdp.timeoutMs = 9000;
		await withSettings.duplicateIdp(first.id);
		const [, copy] = withSettings.current!.idps;
		expect(copy.http.timeoutMs).toBe(5000);
		expect(withSettings.current!.idps[0].http.timeoutMs).toBe(5000);
		withSettings.dispose();
	});

	it('REQ-SET-003 new flows use the settings redirect URI', async () => {
		const settings = newSettings();
		settings.newFlow.redirectUri = 'https://spoofed.invalid/cb';
		const withSettings = new WorkspaceStore(ipc, () => settings);
		await withSettings.init();
		const idp = withSettings.addIdp()!;
		const client = withSettings.addClient(idp.id)!;
		const flow = withSettings.addFlow(idp.id, client.id, 'authorization_code_pkce')!;
		expect(flow.params.redirectUri).toBe('https://spoofed.invalid/cb');
		withSettings.dispose();
	});
});

describe('WorkspaceStore export and import', () => {
	it('REQ-WS-012 exporting reports the count and path; a dismissed dialog says nothing', async () => {
		await store.init();
		ipc.savePath = 'C:/out/x.oidcbundle.json';
		await store.exportWorkspaces(['scratchpad'], { runs: false, settings: null });
		expect(store.toast).toBe('Exported 1 workspace to C:/out/x.oidcbundle.json');
		const file = JSON.parse(ipc.files.get('C:/out/x.oidcbundle.json') ?? '');
		expect(file.workspaces).toHaveLength(1);
		expect(file.workspaces[0].runs).toEqual([]);

		store.toast = null;
		ipc.savePath = null;
		await store.exportWorkspaces(['scratchpad'], { runs: false, settings: null });
		expect(store.toast).toBeNull();
	});

	it('REQ-WS-012 the default file name is oidc-tester-<date>.oidcbundle.json and the menu export names the workspace', async () => {
		await store.init();
		const names: (string | undefined)[] = [];
		ipc.pickSavePath = async (opts) => {
			names.push(opts.defaultPath);
			return null;
		};
		await store.exportWorkspaces(['scratchpad'], { runs: false, settings: null });
		await store.exportCurrent();
		expect(names[0]).toMatch(/^oidc-tester-\d{4}-\d{2}-\d{2}\.oidcbundle\.json$/);
		expect(names[1]).toBe('Scratchpad.oidcbundle.json');
	});

	it('REQ-WS-012 an export failure becomes a toast', async () => {
		await store.init();
		await store.exportWorkspaces(['missing'], { runs: false, settings: null });
		expect(store.toast).toMatch(/^Could not export: missing: /);
	});

	it('REQ-WS-013 importing adds the entries, opens the first and toasts the count', async () => {
		await store.init();
		ipc.savePath = 'C:/out/b.oidcbundle.json';
		await store.exportWorkspaces(['scratchpad'], { runs: false, settings: null });
		ipc.openPath = 'C:/out/b.oidcbundle.json';
		const picked = await store.pickImport();
		expect(picked?.entries).toHaveLength(1);

		await store.importEntries(picked!.entries);

		expect(store.toast).toBe('Imported 1 workspace');
		expect(store.current?.name).toBe('Scratchpad (imported)');
		expect(store.workspaces.map((w) => w.name)).toContain('Scratchpad (imported)');
	});

	it('REQ-WS-013 an invalid file toasts the reason and picks nothing; no entries imports nothing', async () => {
		await store.init();
		ipc.openPath = 'C:/in/bad.json';
		ipc.files.set('C:/in/bad.json', '[]');
		expect(await store.pickImport()).toBeNull();
		expect(store.toast).toMatch(/^Not a valid OIDC Tester export file: /);

		store.toast = null;
		await store.importEntries([]);
		expect(store.toast).toBeNull();
	});
});
