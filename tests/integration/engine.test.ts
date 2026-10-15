import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Run } from '#lib/model/run.js';
import {
	newClient,
	newFlow,
	newIdp,
	type Client,
	type Flow,
	type FlowType,
	type Idp,
	type KV
} from '#lib/model/schema.js';
import { executeRun, callUserInfo, type RunContext } from '#lib/run/engine.js';
import { clientSecretKey, passwordKey } from '#lib/state/secrets.js';
import { startMockIdp, type MockIdp } from '../mock-idp/server.ts';
import { createNodeIpc, type NodeIpc } from '../support/nodeIpc.ts';

const REDIRECT = 'http://spoofed.invalid/cb';

let mock: MockIdp;
let tlsMock: MockIdp;
beforeAll(async () => {
	mock = await startMockIdp({ port: 0, tls: false, cors: 'none' });
	tlsMock = await startMockIdp({ port: 0, tls: true, cors: 'none' });
}, 30_000);
afterAll(async () => {
	await Promise.all([mock.stop(), tlsMock.stop()]);
});

const created: NodeIpc[] = [];
afterEach(async () => {
	await Promise.all(created.splice(0).map((ipc) => ipc.dispose()));
});

interface Setup {
	ipc: NodeIpc;
	idp: Idp;
	client: Client;
	flow: Flow;
	ctx: (overrides?: Partial<RunContext>) => RunContext;
}

const kv = (name: string, value: string): KV => ({ name, value, enabled: true });

function setup(
	type: FlowType,
	options: {
		base?: MockIdp;
		clientId?: string;
		auth?: Client['auth'];
		secret?: string;
		tlsInsecure?: boolean;
		approve?: boolean;
	} = {}
): Setup {
	const base = options.base ?? mock;
	const idp = newIdp('Mock');
	idp.issuer = base.url;
	idp.endpoints = {
		authorization: `${base.url}/authorize`,
		token: `${base.url}/token`,
		userinfo: `${base.url}/userinfo`,
		jwks: `${base.url}/jwks`,
		deviceAuthorization: `${base.url}/device_authorization`,
		endSession: `${base.url}/logout`
	};
	const auth = options.auth ?? 'none';
	const client = newClient('Mock client');
	Object.assign(client, {
		clientId: options.clientId ?? 'public-spa',
		auth,
		hasSecret: options.secret !== undefined,
		jwtAlg: 'HS256'
	});
	idp.clients.push(client);
	idp.http.proxy = { mode: 'none', url: '' };
	idp.http.tlsInsecure = options.tlsInsecure ?? false;
	const flow = newFlow(type);
	flow.params.redirectUri = REDIRECT;
	if (options.approve !== false && type !== 'client_credentials' && type !== 'password') {
		// Skip the login form; device flow sends extraAuthParams to the device endpoint.
		flow.params.extraAuthParams = [kv('mock_auto_approve', '1')];
	}
	client.flows.push(flow);

	const ipc = createNodeIpc();
	created.push(ipc);
	if (options.secret !== undefined)
		ipc.state.secrets.set(clientSecretKey(client.id), options.secret);
	return {
		ipc,
		idp,
		client,
		flow,
		ctx: (overrides = {}) => ({
			ipc,
			workspaceId: 'ws',
			idp,
			client,
			flow,
			signal: new AbortController().signal,
			// The mock IdP enforces the polling interval (slow_down), so device polling waits for real.
			sleep: (ms) => delay(ms),
			...overrides
		})
	};
}

const levels = (run: Run) => Object.fromEntries(run.validations.map((v) => [v.id, v.level]));
const idtRows = (run: Run) => run.validations.filter((v) => v.id.startsWith('idt.'));

describe('engine against the mock IdP', () => {
	it('REQ-FLOW-002 authorization code + PKCE with a spoofed redirect yields verified tokens', async () => {
		const s = setup('authorization_code_pkce');
		const run = await executeRun(s.ctx());

		expect(run.error).toBeUndefined();
		expect(run.status).toBe('success');
		expect(s.ipc.state.authWindowOpens[0]).toMatchObject({ redirectUri: REDIRECT });
		expect(run.callback?.code).toBeTruthy();
		expect(run.tokens?.id_token).toBeTruthy();
		const byId = levels(run);
		expect(byId['sig.id_token']).toBe('ok');
		expect(byId['sig.access_token']).toBe('ok');
		expect(idtRows(run).length).toBeGreaterThanOrEqual(6);
		expect(idtRows(run).filter((v) => v.level !== 'ok')).toEqual([]);
		// authorize navigation + redirect to the spoofed URI, token POST, one JWKS GET
		expect(run.navigations.at(-1)?.url.startsWith(REDIRECT)).toBe(true);
		expect(run.exchanges.filter((e) => e.request.url.endsWith('/jwks'))).toHaveLength(1);
		expect(run.exchanges.filter((e) => e.request.url.endsWith('/token'))).toHaveLength(1);
	});

	it('REQ-FLOW-001 confidential client with client_secret_basic exchanges the code, then UserInfo works', async () => {
		const s = setup('authorization_code', {
			clientId: 'conf-basic',
			auth: 'client_secret_basic',
			secret: 'basic-secret'
		});
		const run = await executeRun(s.ctx());

		expect(run.status).toBe('success');
		expect(levels(run)['sig.id_token']).toBe('ok');
		const accessToken = run.tokens?.access_token ?? '';
		const info = await callUserInfo(s.ctx(), accessToken);
		expect(info.error).toBeUndefined();
		expect(info.body).toMatchObject({ sub: 'alice-0001' });
		expect(info.exchange?.request.headers).toContainEqual([
			'Authorization',
			`Bearer ${accessToken}`
		]);
	});

	it('REQ-FLOW-001 an access_denied authorization error ends the run with source authorization', async () => {
		const s = setup('authorization_code_pkce');
		s.flow.params.extraAuthParams = [kv('mock_error', 'access_denied')];
		const run = await executeRun(s.ctx());

		expect(run.status).toBe('error');
		expect(run.error).toMatchObject({ source: 'authorization', error: 'access_denied' });
		expect(run.exchanges.filter((e) => e.request.url.endsWith('/token'))).toHaveLength(0);
	});

	it('REQ-FLOW-003 implicit id_token token takes the tokens from the fragment without a token call', async () => {
		const s = setup('implicit');
		s.flow.params.responseType = 'id_token token';
		const run = await executeRun(s.ctx());

		expect(run.error).toBeUndefined();
		expect(run.status).toBe('success');
		expect(run.exchanges.filter((e) => e.request.url.endsWith('/token'))).toHaveLength(0);
		expect(run.tokens?.access_token).toBeTruthy();
		const byId = levels(run);
		expect(byId['idt.at_hash']).toBe('ok');
		expect(byId['sig.id_token']).toBe('ok');
		expect(idtRows(run).filter((v) => v.level !== 'ok')).toEqual([]);
	});

	it('REQ-FLOW-004 hybrid code id_token keeps the front-channel id_token (c_hash ok) and exchanges the code', async () => {
		const s = setup('hybrid', {
			clientId: 'conf-post',
			auth: 'client_secret_post',
			secret: 'post-secret'
		});
		s.flow.params.responseType = 'code id_token';
		s.flow.params.usePkce = true;
		const run = await executeRun(s.ctx());

		expect(run.error).toBeUndefined();
		expect(run.status).toBe('success');
		expect(run.callback?.id_token).toBeTruthy();
		expect(run.exchanges.filter((e) => e.request.url.endsWith('/token'))).toHaveLength(1);
		expect(run.tokens?.access_token).toBeTruthy();
		expect(levels(run)['idt.c_hash']).toBe('ok');
		expect(idtRows(run).filter((v) => v.level !== 'ok')).toEqual([]);
	});

	it.each([
		['conf-basic', 'client_secret_basic', 'basic-secret'],
		['conf-post', 'client_secret_post', 'post-secret'],
		['conf-jwt', 'client_secret_jwt', 'jwt-secret']
	] as const)(
		'REQ-FLOW-005 client_credentials with %s (%s) returns an access token and opens no popup',
		async (clientId, auth, secret) => {
			const s = setup('client_credentials', { clientId, auth, secret });
			const run = await executeRun(s.ctx());

			expect(run.error).toBeUndefined();
			expect(run.status).toBe('success');
			expect(s.ipc.state.authWindowOpens).toHaveLength(0);
			expect(run.tokens?.access_token).toBeTruthy();
			expect(levels(run)['sig.access_token']).toBe('ok');
		}
	);

	it('REQ-FLOW-006 password grant sends the stored password', async () => {
		const s = setup('password', {
			clientId: 'conf-basic',
			auth: 'client_secret_basic',
			secret: 'basic-secret'
		});
		s.flow.params.username = 'alice';
		s.ipc.state.secrets.set(passwordKey(s.flow.id), 'alice-pw');
		const run = await executeRun(s.ctx());

		expect(run.error).toBeUndefined();
		expect(run.status).toBe('success');
		expect(run.tokens?.access_token).toBeTruthy();
	});

	it('REQ-FLOW-007 refresh_token redeems the refresh token obtained by an earlier run', async () => {
		const first = setup('authorization_code_pkce');
		first.flow.params.scope = 'openid offline_access';
		const issued = await executeRun(first.ctx());
		const refreshToken = issued.tokens?.refresh_token;
		expect(refreshToken).toBeTruthy();

		const second = setup('refresh_token');
		second.flow.params.refreshToken = refreshToken ?? '';
		second.flow.params.scope = '';
		const run = await executeRun(second.ctx());

		expect(run.error).toBeUndefined();
		expect(run.status).toBe('success');
		expect(run.tokens?.access_token).toBeTruthy();
	});

	it('REQ-FLOW-010 X-Mock-Error from the IdP headers becomes a token RunError', async () => {
		const s = setup('client_credentials', {
			clientId: 'conf-basic',
			auth: 'client_secret_basic',
			secret: 'basic-secret'
		});
		s.idp.http.headers = [kv('X-Mock-Error', 'invalid_grant')];
		const run = await executeRun(s.ctx());

		expect(run.status).toBe('error');
		expect(run.error).toMatchObject({ source: 'token', error: 'invalid_grant', httpStatus: 400 });
		expect(run.tokens).toBeUndefined();
	});

	it('REQ-FLOW-010 a self-signed https IdP gives a tls error unless TLS validation is skipped', async () => {
		const strict = setup('client_credentials', {
			base: tlsMock,
			clientId: 'conf-basic',
			auth: 'client_secret_basic',
			secret: 'basic-secret'
		});
		const failed = await executeRun(strict.ctx());
		expect(failed.status).toBe('error');
		expect(failed.error).toMatchObject({ source: 'tls', error: 'tls' });
		expect(failed.failures).toHaveLength(1);

		const lenient = setup('client_credentials', {
			base: tlsMock,
			clientId: 'conf-basic',
			auth: 'client_secret_basic',
			secret: 'basic-secret',
			tlsInsecure: true
		});
		const passed = await executeRun(lenient.ctx());
		expect(passed.error).toBeUndefined();
		expect(passed.status).toBe('success');
		expect(levels(passed)['sig.access_token']).toBe('ok');
	});

	it(
		'REQ-FLOW-008 device flow shows the user code, polls until the popup approves and returns tokens',
		{ timeout: 20_000 },
		async () => {
			const s = setup('device_code');
			s.flow.params.extraAuthParams = [kv('mock_auto_approve', '1'), kv('mock_interval', '1')];
			const codes: Array<string | null> = [];
			const run = await executeRun(
				s.ctx({ onDeviceCode: (info) => codes.push(info?.userCode ?? null) })
			);

			expect(run.error).toBeUndefined();
			expect(run.status).toBe('success');
			expect(codes).toHaveLength(2);
			expect(codes[0]).toBeTruthy();
			expect(codes[1]).toBeNull();
			expect(run.tokens?.access_token).toBeTruthy();
			expect(s.ipc.state.authWindowOpens[0]).toMatchObject({ redirectUri: null });
			expect(s.ipc.state.authWindowCloses).toBeGreaterThan(0);
		}
	);

	it('REQ-FLOW-012 aborting a device run that waits for the user cancels it, stops polling and closes the window', async () => {
		const s = setup('device_code');
		s.flow.params.extraAuthParams = [kv('mock_interval', '30')]; // never approved, long interval
		const controller = new AbortController();
		const run = await executeRun(
			s.ctx({
				signal: controller.signal,
				onDeviceCode: (info) => {
					if (info) queueMicrotask(() => controller.abort());
				}
			})
		);

		expect(run.status).toBe('cancelled');
		expect(run.error).toBeUndefined();
		expect(s.ipc.state.authWindowCloses).toBeGreaterThan(0);
		expect(run.exchanges.filter((e) => e.request.url.endsWith('/token'))).toHaveLength(0);
	});
});
