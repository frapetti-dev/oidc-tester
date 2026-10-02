import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newFlow, newIdp, newWorkspace } from '$lib/model/schema';
import { createDebouncedSaver } from './autosave';
import { addFlow, addIdp, deleteFlow, deleteIdp, duplicateFlow, duplicateIdp } from './ops';

describe('IdP and flow CRUD', () => {
	it('REQ-WS-009 adds an IdP and flows with factory defaults', () => {
		const ws = newWorkspace('W');
		const idp = addIdp(ws, 'Keycloak');
		expect(ws.idps).toHaveLength(1);
		expect(idp.name).toBe('Keycloak');
		const flow = addFlow(idp, 'client_credentials');
		expect(idp.flows).toEqual([flow]);
		expect(flow.params.scope).toBe('');
		const pkce = addFlow(idp, 'authorization_code_pkce');
		expect(pkce.params).toMatchObject({
			scope: 'openid profile email',
			redirectUri: 'http://localhost:8080/callback',
			usePkce: true
		});
		expect(pkce.cleanSession).toBe(false);
	});

	it('REQ-WS-009 duplicating an IdP assigns new ids to the IdP and all flows, keeps content, and lists secrets to copy', () => {
		const ws = newWorkspace('W');
		const idp = addIdp(ws, 'Source');
		idp.client.hasSecret = true;
		idp.http.headers.push({ name: 'X', value: '1', enabled: true });
		const flow = addFlow(idp, 'password');
		flow.params.hasPassword = true;

		const { copy, secretCopies } = duplicateIdp(ws, idp.id);

		expect(ws.idps.map((i) => i.name)).toEqual(['Source', 'Source (copy)']);
		expect(copy.id).not.toBe(idp.id);
		expect(copy.flows[0].id).not.toBe(flow.id);
		expect(copy.http.headers).toEqual(idp.http.headers);
		expect(copy.http.headers).not.toBe(idp.http.headers);
		expect(secretCopies).toEqual([
			{ from: `idp:${idp.id}:client_secret`, to: `idp:${copy.id}:client_secret` },
			{ from: `flow:${flow.id}:password`, to: `flow:${copy.flows[0].id}:password` }
		]);
	});

	it('REQ-WS-009 duplicating a flow inserts a renamed copy with a new id', () => {
		const idp = newIdp();
		const flow = newFlow('authorization_code');
		idp.flows.push(flow);
		const { copy, secretCopies } = duplicateFlow(idp, flow.id);
		expect(idp.flows.map((f) => f.name)).toEqual([
			'Authorization Code',
			'Authorization Code (copy)'
		]);
		expect(copy.id).not.toBe(flow.id);
		expect(secretCopies).toEqual([]);
	});

	it('REQ-WS-009 deleting returns the secret keys that must be removed', () => {
		const ws = newWorkspace('W');
		const keep = addIdp(ws, 'Keep');
		const drop = addIdp(ws, 'Drop');
		drop.client.hasSecret = true;
		const flow = addFlow(drop, 'password');
		flow.params.hasPassword = true;
		const other = addFlow(drop, 'device_code');

		expect(deleteFlow(drop, other.id)).toEqual([]);
		expect(deleteFlow(drop, flow.id)).toEqual([`flow:${flow.id}:password`]);
		addFlow(drop, 'password').params.hasPassword = true;
		const keys = deleteIdp(ws, drop.id);
		expect(keys).toHaveLength(2);
		expect(keys[0]).toBe(`idp:${drop.id}:client_secret`);
		expect(ws.idps).toEqual([keep]);
	});
});

describe('autosave debounce', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('REQ-WS-002 writes 500 ms after the last change; rapid changes produce a single write', async () => {
		const save = vi.fn(async (_value: string) => {});
		const saver = createDebouncedSaver(save, 500);
		saver.schedule('a');
		await vi.advanceTimersByTimeAsync(300);
		saver.schedule('b');
		await vi.advanceTimersByTimeAsync(499);
		expect(save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith('b');
	});

	it('REQ-WS-002 flush writes a pending change immediately and cancel drops it', async () => {
		const save = vi.fn(async (_value: string) => {});
		const saver = createDebouncedSaver(save, 500);
		saver.schedule('x');
		await saver.flush();
		expect(save).toHaveBeenCalledWith('x');
		saver.schedule('y');
		saver.cancel();
		await vi.advanceTimersByTimeAsync(1000);
		expect(save).toHaveBeenCalledTimes(1);
	});
});
