import { describe, expect, it } from 'vitest';
import type {
	Header,
	HttpExchange,
	HttpFailure,
	HttpRequestSpec,
	HttpResult,
	IpcApi
} from '$lib/ipc/types';
import { newFlow, newIdp, type Flow, type Idp } from '$lib/model/schema';
import { newHttpLog } from './transport';
import { buildTokenRequest, requestTokens, type Grant } from './tokenRequest';

const TOKEN = 'https://idp.test/token';
const ORIGIN = 'https://app.example';

function makeIdp(auth: Idp['client']['auth'] = 'client_secret_basic'): Idp {
	const idp = newIdp();
	idp.endpoints.token = TOKEN;
	idp.client = { ...idp.client, clientId: 'cid', auth, hasSecret: auth !== 'none' };
	return idp;
}

function exchange(spec: HttpRequestSpec, status: number, headers: Header[], body: string) {
	const ex: HttpExchange = {
		id: crypto.randomUUID(),
		startedAt: '2026-01-01T00:00:00Z',
		durationMs: 1,
		request: { method: spec.method, url: spec.url, headers: spec.headers, body: spec.body },
		response: { status, statusText: '', httpVersion: 'HTTP/1.1', headers, body, bodyBase64: null }
	};
	return ex;
}

function fakeIpc(
	handler: (
		spec: HttpRequestSpec
	) => HttpResult | { status: number; headers?: Header[]; body?: string }
) {
	const calls: HttpRequestSpec[] = [];
	const ipc = {
		httpSend: async (spec: HttpRequestSpec): Promise<HttpResult> => {
			calls.push(spec);
			const r = handler(spec);
			if ('ok' in r) return r;
			return { ok: true, exchange: exchange(spec, r.status, r.headers ?? [], r.body ?? '') };
		}
	} as unknown as IpcApi;
	return { ipc, calls };
}

const body = (spec: HttpRequestSpec) => new URLSearchParams(spec.body ?? '');
const okTokens = {
	status: 200,
	body: JSON.stringify({ access_token: 'at', token_type: 'Bearer' })
};

async function build(idp: Idp, flow: Flow, grant: Grant, secret: string | null = 'sec') {
	const r = await buildTokenRequest({ idp, flow, grant, secret });
	if (!r.ok) throw new Error('expected ok');
	return r.spec;
}

describe('buildTokenRequest', () => {
	it('builds an authorization_code form POST with PKCE verifier and client_secret_basic', async () => {
		const spec = await build(makeIdp(), newFlow('authorization_code_pkce'), {
			type: 'authorization_code',
			code: 'the-code',
			redirectUri: 'http://spoofed.invalid/cb',
			codeVerifier: 'verifier123'
		});
		expect(spec.method).toBe('POST');
		expect(spec.url).toBe(TOKEN);
		expect([...body(spec)]).toEqual([
			['grant_type', 'authorization_code'],
			['code', 'the-code'],
			['redirect_uri', 'http://spoofed.invalid/cb'],
			['code_verifier', 'verifier123']
		]);
		expect(spec.headers).toEqual([
			['Content-Type', 'application/x-www-form-urlencoded'],
			['Accept', 'application/json'],
			['Authorization', `Basic ${btoa('cid:sec')}`]
		]);
	});

	it('omits code_verifier when there is none and sends client_id for public clients', async () => {
		const spec = await build(
			makeIdp('none'),
			newFlow('authorization_code'),
			{ type: 'authorization_code', code: 'c', redirectUri: 'http://x/cb', codeVerifier: null },
			null
		);
		const params = body(spec);
		expect(params.has('code_verifier')).toBe(false);
		expect(params.get('client_id')).toBe('cid');
		expect(spec.headers.some(([n]) => n === 'Authorization')).toBe(false);
	});

	it('client_credentials sends scope, audience and resource only when non-empty', async () => {
		const flow = newFlow('client_credentials');
		const empty = await build(makeIdp('client_secret_post'), flow, { type: 'client_credentials' });
		expect([...body(empty)]).toEqual([
			['grant_type', 'client_credentials'],
			['client_id', 'cid'],
			['client_secret', 'sec']
		]);
		flow.params.scope = 'read write';
		flow.params.audience = 'https://api';
		flow.params.resource = 'https://res';
		const full = await build(makeIdp('client_secret_post'), flow, { type: 'client_credentials' });
		expect(body(full).get('scope')).toBe('read write');
		expect(body(full).get('audience')).toBe('https://api');
		expect(body(full).get('resource')).toBe('https://res');
	});

	it('builds password, refresh_token and device_code bodies', async () => {
		const idp = makeIdp();
		const flow = newFlow('password');
		flow.params.scope = 'openid';
		const password = await build(idp, flow, {
			type: 'password',
			username: 'alice',
			password: 'pw'
		});
		expect([...body(password)]).toEqual([
			['grant_type', 'password'],
			['username', 'alice'],
			['password', 'pw'],
			['scope', 'openid']
		]);
		const refresh = await build(idp, flow, { type: 'refresh_token', refreshToken: 'rt' });
		expect([...body(refresh)]).toEqual([
			['grant_type', 'refresh_token'],
			['refresh_token', 'rt'],
			['scope', 'openid']
		]);
		flow.params.scope = '';
		const refreshNoScope = await build(idp, flow, { type: 'refresh_token', refreshToken: 'rt' });
		expect(body(refreshNoScope).has('scope')).toBe(false);
		const device = await build(idp, flow, { type: 'device_code', deviceCode: 'dc' });
		expect([...body(device)]).toEqual([
			['grant_type', 'urn:ietf:params:oauth:grant-type:device_code'],
			['device_code', 'dc']
		]);
	});

	it('enabled extraTokenParams are appended and override same-name params', async () => {
		const flow = newFlow('client_credentials');
		flow.params.scope = 'a';
		flow.params.extraTokenParams = [
			{ name: 'scope', value: 'overridden', enabled: true },
			{ name: 'custom', value: 'x y', enabled: true },
			{ name: 'off', value: 'no', enabled: false },
			{ name: '  ', value: 'blank', enabled: true }
		];
		const spec = await build(makeIdp('client_secret_post'), flow, { type: 'client_credentials' });
		const params = body(spec);
		expect(params.getAll('scope')).toEqual(['overridden']);
		expect(params.get('custom')).toBe('x y');
		expect(params.has('off')).toBe(false);
		expect(params.get('grant_type')).toBe('client_credentials');
		expect(params.get('client_id')).toBe('cid');
	});

	it('merges IdP headers, flow headers and Origin ahead of the protocol headers', async () => {
		const idp = makeIdp('none');
		idp.http.origin = ORIGIN;
		idp.http.headers = [{ name: 'X-Idp', value: 'idp', enabled: true }];
		const flow = newFlow('client_credentials');
		flow.headers = [{ name: 'accept', value: 'text/plain', enabled: true }];
		const spec = await build(idp, flow, { type: 'client_credentials' }, null);
		expect(spec.headers).toEqual([
			['X-Idp', 'idp'],
			['accept', 'text/plain'],
			['Origin', ORIGIN],
			['Content-Type', 'application/x-www-form-urlencoded']
		]);
	});
});

describe('requestTokens', () => {
	const flow = newFlow('client_credentials');
	const grant: Grant = { type: 'client_credentials' };

	it('REQ-CAUTH-005 a missing secret fails before any HTTP request is made', async () => {
		const { ipc, calls } = fakeIpc(() => okTokens);
		const log = newHttpLog();
		const result = await requestTokens(ipc, { idp: makeIdp(), flow, grant, secret: null, log });
		expect(result.tokens).toBeUndefined();
		expect(result.error).toMatchObject({ source: 'validation', error: 'missing_client_secret' });
		expect(calls).toHaveLength(0);
		expect(log.exchanges).toHaveLength(0);
	});

	it('sends the request, logs the exchange and returns parsed tokens', async () => {
		const { ipc, calls } = fakeIpc(() => okTokens);
		const log = newHttpLog();
		const result = await requestTokens(ipc, { idp: makeIdp(), flow, grant, secret: 'sec', log });
		expect(result.tokens?.access_token).toBe('at');
		expect(result.validations).toEqual([]);
		expect(calls).toHaveLength(1);
		expect(log.exchanges).toHaveLength(1);
	});

	it('returns a network RunError and logs the failure when the transport fails', async () => {
		const failure: HttpFailure = {
			kind: 'connect',
			message: 'refused',
			request: { method: 'POST', url: TOKEN, headers: [], body: null }
		};
		const { ipc } = fakeIpc(() => ({ ok: false, failure }));
		const log = newHttpLog();
		const result = await requestTokens(ipc, { idp: makeIdp(), flow, grant, secret: 'sec', log });
		expect(result.error).toEqual({ source: 'network', error: 'connect', detail: 'refused' });
		expect(log.failures).toEqual([failure]);
	});

	it('REQ-CORS-004 sends a logged OPTIONS preflight before the POST when corsCheck and origin are set', async () => {
		const idp = makeIdp();
		idp.http.corsCheck = true;
		idp.http.origin = ORIGIN;
		const { ipc, calls } = fakeIpc((spec) =>
			spec.method === 'OPTIONS'
				? { status: 204, headers: [['Access-Control-Allow-Origin', ORIGIN]] }
				: { ...okTokens, headers: [['Access-Control-Allow-Origin', ORIGIN]] }
		);
		const log = newHttpLog();
		await requestTokens(ipc, { idp, flow, grant, secret: 'sec', log });
		expect(calls.map((c) => c.method)).toEqual(['OPTIONS', 'POST']);
		expect(calls[0].headers).toEqual([
			['Origin', ORIGIN],
			['Access-Control-Request-Method', 'POST'],
			['Access-Control-Request-Headers', 'authorization']
		]);
		expect(log.exchanges.map((e) => e.request.method)).toEqual(['OPTIONS', 'POST']);
	});

	it.each([
		['corsCheck off', false, ORIGIN],
		['origin empty', true, '']
	])('REQ-CORS-004 sends no preflight when %s', async (_name, corsCheck, origin) => {
		const idp = makeIdp();
		idp.http.corsCheck = corsCheck;
		idp.http.origin = origin;
		const { ipc, calls } = fakeIpc(() => okTokens);
		const result = await requestTokens(ipc, { idp, flow, grant, secret: 'sec', log: newHttpLog() });
		expect(calls.map((c) => c.method)).toEqual(['POST']);
		expect(result.validations).toEqual([]);
	});

	it('REQ-CORS-005 a blocked CORS result is a warn row but the token request is still sent and parsed', async () => {
		const idp = makeIdp();
		idp.http.corsCheck = true;
		idp.http.origin = ORIGIN;
		const { ipc, calls } = fakeIpc((spec) =>
			spec.method === 'OPTIONS' ? { status: 204 } : okTokens
		);
		const result = await requestTokens(ipc, { idp, flow, grant, secret: 'sec', log: newHttpLog() });
		expect(calls.map((c) => c.method)).toEqual(['OPTIONS', 'POST']);
		expect(result.tokens?.access_token).toBe('at');
		expect(result.validations).toHaveLength(1);
		expect(result.validations[0]).toMatchObject({ id: 'cors', level: 'warn' });
		expect(result.validations[0].message).toMatch(
			new RegExp(`^Browser at ${ORIGIN} would block this request: .*Access-Control-Allow-Origin`)
		);
	});

	it('REQ-CORS-005 an allowed CORS result is an ok row', async () => {
		const idp = makeIdp();
		idp.http.corsCheck = true;
		idp.http.origin = ORIGIN;
		const cors: Header[] = [
			['Access-Control-Allow-Origin', ORIGIN],
			['Access-Control-Allow-Headers', 'Authorization']
		];
		const { ipc } = fakeIpc((spec) =>
			spec.method === 'OPTIONS' ? { status: 204, headers: cors } : { ...okTokens, headers: cors }
		);
		const result = await requestTokens(ipc, { idp, flow, grant, secret: 'sec', log: newHttpLog() });
		expect(result.validations).toEqual([
			{ id: 'cors', level: 'ok', message: `CORS allowed for ${ORIGIN}` }
		]);
	});

	it('REQ-CORS-005 a failed preflight request still lets the token request go out, with a warn row', async () => {
		const idp = makeIdp();
		idp.http.corsCheck = true;
		idp.http.origin = ORIGIN;
		const failure: HttpFailure = {
			kind: 'timeout',
			message: 'slow',
			request: { method: 'OPTIONS', url: TOKEN, headers: [], body: null }
		};
		const { ipc, calls } = fakeIpc((spec) =>
			spec.method === 'OPTIONS' ? { ok: false, failure } : okTokens
		);
		const result = await requestTokens(ipc, { idp, flow, grant, secret: 'sec', log: newHttpLog() });
		expect(calls.map((c) => c.method)).toEqual(['OPTIONS', 'POST']);
		expect(result.tokens?.access_token).toBe('at');
		expect(result.validations[0]).toMatchObject({ id: 'cors', level: 'warn' });
		expect(result.validations[0].message).toContain('slow');
	});
});
