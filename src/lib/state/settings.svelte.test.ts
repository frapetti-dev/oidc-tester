import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_DOC, newSettings } from '#lib/model/settings.js';
import { createMemoryIpc, type MemoryIpc } from '#lib/testing/memoryIpc.js';
import { SettingsStore } from './settings.svelte';

let ipc: MemoryIpc;
let store: SettingsStore;

beforeEach(() => {
	vi.useFakeTimers();
	ipc = createMemoryIpc();
	store = new SettingsStore(ipc);
});
afterEach(() => {
	store.dispose();
	vi.useRealTimers();
});

describe('SettingsStore', () => {
	it('REQ-SET-001 without settings.json the defaults apply and nothing is written', async () => {
		await store.load();
		expect(store.current).toEqual({
			schemaVersion: 1,
			newIdp: { timeoutMs: 30000, proxy: { mode: 'system', url: '' }, tlsInsecure: false },
			newFlow: { redirectUri: 'http://localhost:8080/callback' },
			runHistoryLimit: 200
		});
		expect(store.error).toBeNull();
		await vi.advanceTimersByTimeAsync(1000);
		expect(ipc.docs.has(SETTINGS_DOC)).toBe(false);
	});

	it('REQ-SET-001 a change is written to settings.json after 500 ms', async () => {
		await store.load();
		store.update((s) => (s.newFlow.redirectUri = 'https://spoofed.invalid/cb'));
		await vi.advanceTimersByTimeAsync(499);
		expect(ipc.docs.has(SETTINGS_DOC)).toBe(false);
		await vi.advanceTimersByTimeAsync(2);
		expect(ipc.docs.get(SETTINGS_DOC)).toMatchObject({
			newFlow: { redirectUri: 'https://spoofed.invalid/cb' }
		});
	});

	it('REQ-SET-001 a stored file is loaded', async () => {
		const saved = newSettings();
		saved.runHistoryLimit = 7;
		ipc.docs.set(SETTINGS_DOC, saved);
		await store.load();
		expect(store.current.runHistoryLimit).toBe(7);
	});

	it('REQ-SET-001 an invalid file reports the error, uses defaults and is overwritten only on the next change', async () => {
		const bad = { schemaVersion: 1, runHistoryLimit: -3 };
		ipc.docs.set(SETTINGS_DOC, bad);
		await store.load();
		expect(store.error).toMatch(/^Settings file is invalid: .+\. Defaults are in use\.$/);
		expect(store.current).toEqual(newSettings());
		await vi.advanceTimersByTimeAsync(1000);
		expect(ipc.docs.get(SETTINGS_DOC)).toEqual(bad);

		store.update((s) => (s.runHistoryLimit = 5));
		await vi.advanceTimersByTimeAsync(600);
		expect(ipc.docs.get(SETTINGS_DOC)).toMatchObject({ runHistoryLimit: 5 });
	});

	it('REQ-SET-001 replace swaps the whole value and saves it', async () => {
		await store.load();
		const next = newSettings();
		next.newIdp.timeoutMs = 5000;
		store.replace(next);
		await store.flush();
		expect(store.current.newIdp.timeoutMs).toBe(5000);
		expect(ipc.docs.get(SETTINGS_DOC)).toMatchObject({ newIdp: { timeoutMs: 5000 } });
	});
});
