import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createMemoryIpc, type MemoryIpc } from '$lib/testing/memoryIpc';
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
		await store.setClientSecret(idp, 's3cret');
		expect(idp.client.hasSecret).toBe(true);
		expect(ipc.secrets.get(`idp:${idp.id}:client_secret`)).toBe('s3cret');

		ipc.failSecretSet = 'denied';
		const flow = store.addFlow(idp.id, 'password')!;
		await store.setFlowPassword(flow, 'pw');
		expect(flow.params.hasPassword).toBe(false);
		expect(store.toast).toBe('Could not store secret in OS keychain: denied');
		expect(JSON.stringify($state.snapshot(store.current))).not.toContain('s3cret');
	});

	it('REQ-SEC-003 clearing a client secret deletes the entry and resets the flag', async () => {
		await store.init();
		const idp = store.addIdp()!;
		await store.setClientSecret(idp, 's3cret');
		await store.clearClientSecret(idp);
		expect(ipc.secrets.size).toBe(0);
		expect(idp.client.hasSecret).toBe(false);
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
});
