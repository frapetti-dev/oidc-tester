import { describe, expect, it } from 'vitest';
import type {
	HttpExchange,
	HttpFailure,
	HttpRequestSpec,
	HttpResult,
	IpcApi
} from '#lib/ipc/types.js';
import { newFlow, newIdp } from '#lib/model/schema.js';
import { buildRequestSpec, mergeHeaders, newHttpLog, sendWithRedirects } from './transport';

function exchange(spec: HttpRequestSpec, status: number, headers: [string, string][] = []) {
	const ex: HttpExchange = {
		id: crypto.randomUUID(),
		startedAt: '2026-01-01T00:00:00Z',
		durationMs: 1,
		request: { method: spec.method, url: spec.url, headers: spec.headers, body: spec.body },
		response: {
			status,
			statusText: '',
			httpVersion: 'HTTP/1.1',
			headers,
			body: '',
			bodyBase64: null
		}
	};
	return ex;
}

function fakeIpc(handler: (spec: HttpRequestSpec, n: number) => HttpResult) {
	const calls: HttpRequestSpec[] = [];
	const ipc = {
		httpSend: async (spec: HttpRequestSpec) => {
			calls.push(spec);
			return handler(spec, calls.length);
		}
	} as unknown as IpcApi;
	return { ipc, calls };
}

const spec = (over: Partial<HttpRequestSpec> = {}): HttpRequestSpec => ({
	method: 'GET',
	url: 'https://idp.test/a',
	headers: [],
	body: null,
	tlsInsecure: false,
	proxy: { mode: 'system', url: null },
	timeoutMs: 1000,
	...over
});

describe('mergeHeaders', () => {
	it('REQ-HTTP-007 IdP headers first, flow header of same name (case-insensitive) replaces, protocol headers unless user-set', () => {
		const merged = mergeHeaders({
			idp: [
				{ name: 'X-A', value: 'idp', enabled: true },
				{ name: 'X-B', value: 'idp-b', enabled: true },
				{ name: 'Accept', value: 'text/plain', enabled: true }
			],
			flow: [
				{ name: 'x-a', value: 'flow', enabled: true },
				{ name: 'X-C', value: 'flow-c', enabled: true }
			],
			protocol: [
				['Content-Type', 'application/x-www-form-urlencoded'],
				['Accept', 'application/json']
			],
			origin: ''
		});
		expect(merged).toEqual([
			['X-B', 'idp-b'],
			['Accept', 'text/plain'],
			['x-a', 'flow'],
			['X-C', 'flow-c'],
			['Content-Type', 'application/x-www-form-urlencoded']
		]);
	});

	it('REQ-HTTP-007 ignores disabled rows and blank names', () => {
		const merged = mergeHeaders({
			idp: [
				{ name: 'X-Off', value: '1', enabled: false },
				{ name: '  ', value: '1', enabled: true }
			],
			flow: [{ name: 'X-On', value: '1', enabled: true }],
			protocol: [],
			origin: ''
		});
		expect(merged).toEqual([['X-On', '1']]);
	});

	it('REQ-HTTP-008 adds Origin from settings, none when empty, user-set Origin wins', () => {
		const base = { idp: [], flow: [], protocol: [] as [string, string][] };
		expect(mergeHeaders({ ...base, origin: 'https://app.example' })).toEqual([
			['Origin', 'https://app.example']
		]);
		expect(mergeHeaders({ ...base, origin: '' })).toEqual([]);
		expect(
			mergeHeaders({
				...base,
				idp: [{ name: 'origin', value: 'https://custom', enabled: true }],
				origin: 'https://app.example'
			})
		).toEqual([['origin', 'https://custom']]);
	});
});

describe('buildRequestSpec', () => {
	it('REQ-HTTP-008 applies IdP http settings (tls, proxy, timeout, origin) to the request spec', () => {
		const idp = newIdp();
		idp.http.tlsInsecure = true;
		idp.http.proxy = { mode: 'url', url: 'http://proxy:8080' };
		idp.http.timeoutMs = 5000;
		idp.http.origin = 'https://app.example';
		const flow = newFlow('client_credentials');
		flow.headers = [{ name: 'X-Flow', value: 'f', enabled: true }];
		const built = buildRequestSpec(idp, flow, {
			method: 'POST',
			url: 'https://idp.test/token',
			protocolHeaders: [['Accept', 'application/json']],
			body: 'a=b'
		});
		expect(built).toEqual({
			method: 'POST',
			url: 'https://idp.test/token',
			headers: [
				['X-Flow', 'f'],
				['Origin', 'https://app.example'],
				['Accept', 'application/json']
			],
			body: 'a=b',
			tlsInsecure: true,
			proxy: { mode: 'url', url: 'http://proxy:8080' },
			timeoutMs: 5000
		});
	});

	it('REQ-HTTP-006 maps proxy none/system to a null url', () => {
		const idp = newIdp();
		idp.http.proxy = { mode: 'none', url: 'ignored' };
		const built = buildRequestSpec(idp, null, { method: 'GET', url: 'https://x.test/' });
		expect(built.proxy).toEqual({ mode: 'none', url: null });
		expect(built.body).toBeNull();
	});
});

describe('sendWithRedirects', () => {
	it('REQ-HTTP-002 follows GET redirects up to 5 hops and logs every hop as an exchange', async () => {
		const { ipc, calls } = fakeIpc((s, n) =>
			n <= 3
				? { ok: true, exchange: exchange(s, 302, [['Location', `/hop${n}`]]) }
				: { ok: true, exchange: exchange(s, 200) }
		);
		const log = newHttpLog();
		const result = await sendWithRedirects(ipc, spec(), log);
		expect(calls.map((c) => c.url)).toEqual([
			'https://idp.test/a',
			'https://idp.test/hop1',
			'https://idp.test/hop2',
			'https://idp.test/hop3'
		]);
		expect(log.exchanges).toHaveLength(4);
		expect(result.final?.response.status).toBe(200);
		expect(result.failure).toBeNull();
		expect(result.error).toBeUndefined();
	});

	it('REQ-HTTP-002 stops with an error on the 6th redirect hop', async () => {
		const { ipc, calls } = fakeIpc((s) => ({
			ok: true,
			exchange: exchange(s, 301, [['location', '/again']])
		}));
		const log = newHttpLog();
		const result = await sendWithRedirects(ipc, spec(), log);
		expect(calls).toHaveLength(6);
		expect(result.error).toMatch(/too many redirects/i);
		expect(result.final?.response.status).toBe(301);
	});

	it('REQ-HTTP-002 never redirects non-GET requests', async () => {
		const { ipc, calls } = fakeIpc((s) => ({
			ok: true,
			exchange: exchange(s, 307, [['Location', '/elsewhere']])
		}));
		const result = await sendWithRedirects(ipc, spec({ method: 'POST', body: 'x' }), newHttpLog());
		expect(calls).toHaveLength(1);
		expect(result.final?.response.status).toBe(307);
	});

	it('REQ-HTTP-002 records a transport failure and returns it', async () => {
		const failure: HttpFailure = {
			kind: 'tls',
			message: 'bad cert',
			request: { method: 'GET', url: 'https://idp.test/a', headers: [], body: null }
		};
		const { ipc } = fakeIpc(() => ({ ok: false, failure }));
		const log = newHttpLog();
		const result = await sendWithRedirects(ipc, spec(), log);
		expect(result.failure).toEqual(failure);
		expect(result.final).toBeNull();
		expect(log.failures).toEqual([failure]);
	});
});
