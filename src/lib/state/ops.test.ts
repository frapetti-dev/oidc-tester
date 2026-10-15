import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newClient, newFlow, newIdp, newWorkspace } from '#lib/model/schema.js';
import { createDebouncedSaver } from './autosave';
import {
	addClient,
	addFlow,
	addIdp,
	deleteClient,
	deleteFlow,
	deleteIdp,
	duplicateClient,
	duplicateFlow,
	duplicateIdp
} from './ops';

describe('IdP, client and flow CRUD', () => {
	it('REQ-WS-009 adds an IdP and flows with factory defaults', () => {
		const ws = newWorkspace('W');
		const idp = addIdp(ws, 'Keycloak');
		expect(ws.idps).toHaveLength(1);
		expect(idp.name).toBe('Keycloak');
		const client = addClient(idp);
		const flow = addFlow(client, 'client_credentials');
		expect(client.flows).toEqual([flow]);
		expect(flow.params.scope).toBe('');
		const pkce = addFlow(client, 'authorization_code_pkce');
		expect(pkce.params).toMatchObject({
			scope: 'openid profile email',
			redirectUri: 'http://localhost:8080/callback',
			usePkce: true
		});
		expect(pkce.cleanSession).toBe(false);
	});

	it('REQ-WS-010 adds a client to an IdP with factory defaults', () => {
		const idp = newIdp();
		const client = addClient(idp);
		expect(idp.clients).toEqual([client]);
		expect(client).toMatchObject({
			name: 'New client',
			clientId: '',
			auth: 'none',
			jwtAlg: 'HS256',
			hasSecret: false,
			flows: []
		});
	});

	it('REQ-WS-009 duplicating an IdP assigns new ids to the IdP, clients and flows, keeps content, and lists secrets to copy', () => {
		const ws = newWorkspace('W');
		const idp = addIdp(ws, 'Source');
		const client = addClient(idp);
		client.hasSecret = true;
		idp.http.headers.push({ name: 'X', value: '1', enabled: true });
		const flow = addFlow(client, 'password');
		flow.params.hasPassword = true;

		const { copy, secretCopies } = duplicateIdp(ws, idp.id);

		expect(ws.idps.map((i) => i.name)).toEqual(['Source', 'Source (copy)']);
		expect(copy.id).not.toBe(idp.id);
		expect(copy.clients[0].id).not.toBe(client.id);
		expect(copy.clients[0].flows[0].id).not.toBe(flow.id);
		expect(copy.http.headers).toEqual(idp.http.headers);
		expect(copy.http.headers).not.toBe(idp.http.headers);
		expect(secretCopies).toEqual([
			{
				from: `client:${client.id}:client_secret`,
				to: `client:${copy.clients[0].id}:client_secret`
			},
			{ from: `flow:${flow.id}:password`, to: `flow:${copy.clients[0].flows[0].id}:password` }
		]);
	});

	it('REQ-WS-010 duplicating a client copies its flows with new ids and lists secrets to copy', () => {
		const idp = newIdp();
		const client = addClient(idp, 'Src');
		client.hasSecret = true;
		const flow = addFlow(client, 'password');
		flow.params.hasPassword = true;

		const { copy, secretCopies } = duplicateClient(idp, client.id);

		expect(idp.clients.map((c) => c.name)).toEqual(['Src', 'Src (copy)']);
		expect(copy.id).not.toBe(client.id);
		expect(copy.flows).toHaveLength(1);
		expect(copy.flows[0].id).not.toBe(flow.id);
		expect(secretCopies).toEqual([
			{ from: `client:${client.id}:client_secret`, to: `client:${copy.id}:client_secret` },
			{ from: `flow:${flow.id}:password`, to: `flow:${copy.flows[0].id}:password` }
		]);
	});

	it('REQ-WS-009 duplicating a flow inserts a renamed copy with a new id', () => {
		const client = newClient();
		const flow = newFlow('authorization_code');
		client.flows.push(flow);
		const { copy, secretCopies } = duplicateFlow(client, flow.id);
		expect(client.flows.map((f) => f.name)).toEqual([
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
		const client = addClient(drop);
		client.hasSecret = true;
		const flow = addFlow(client, 'password');
		flow.params.hasPassword = true;
		const other = addFlow(client, 'device_code');

		expect(deleteFlow(client, other.id)).toEqual([]);
		expect(deleteFlow(client, flow.id)).toEqual([`flow:${flow.id}:password`]);
		addFlow(client, 'password').params.hasPassword = true;
		const keys = deleteIdp(ws, drop.id);
		expect(keys).toHaveLength(2);
		expect(keys[0]).toBe(`client:${client.id}:client_secret`);
		expect(ws.idps).toEqual([keep]);
	});

	it('REQ-WS-010 deleting a client returns its client secret and flow password keys and removes it', () => {
		const idp = newIdp();
		const keep = addClient(idp, 'Keep');
		const drop = addClient(idp, 'Drop');
		drop.hasSecret = true;
		const flow = addFlow(drop, 'password');
		flow.params.hasPassword = true;
		addFlow(drop, 'device_code');

		expect(deleteClient(idp, drop.id)).toEqual([
			`client:${drop.id}:client_secret`,
			`flow:${flow.id}:password`
		]);
		expect(idp.clients).toEqual([keep]);
	});

	it('REQ-WS-010 deleting an IdP returns the secret keys across all its clients', () => {
		const ws = newWorkspace('W');
		const idp = addIdp(ws, 'Drop');
		const a = addClient(idp);
		a.hasSecret = true;
		const b = addClient(idp);
		b.hasSecret = true;
		const flow = addFlow(b, 'password');
		flow.params.hasPassword = true;

		expect(deleteIdp(ws, idp.id)).toEqual([
			`client:${a.id}:client_secret`,
			`client:${b.id}:client_secret`,
			`flow:${flow.id}:password`
		]);
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
