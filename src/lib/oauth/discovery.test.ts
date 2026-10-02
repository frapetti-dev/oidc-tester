import { describe, expect, it } from 'vitest';
import type {
	HttpExchange,
	HttpFailure,
	HttpRequestSpec,
	HttpResult,
	IpcApi
} from '$lib/ipc/types';
import { newFlow, newIdp, type Flow, type Idp } from '$lib/model/schema';
import {
	applyDiscovery,
	discover,
	discoverySuggestions,
	unsupportedWarnings,
	type DiscoveryResult
} from './discovery';
import { newHttpLog } from './transport';

function exchange(
	spec: HttpRequestSpec,
	status: number,
	body: string,
	headers: [string, string][] = []
): HttpResult {
	const ex: HttpExchange = {
		id: crypto.randomUUID(),
		startedAt: '2026-01-01T00:00:00Z',
		durationMs: 1,
		request: { method: spec.method, url: spec.url, headers: spec.headers, body: spec.body },
		response: { status, statusText: '', httpVersion: 'HTTP/1.1', headers, body, bodyBase64: null }
	};
	return { ok: true, exchange: ex };
}

function failure(spec: HttpRequestSpec, kind: HttpFailure['kind'], message: string): HttpResult {
	return {
		ok: false,
		failure: {
			kind,
			message,
			request: { method: spec.method, url: spec.url, headers: spec.headers, body: spec.body }
		}
	};
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

const doc = (over: Record<string, unknown> = {}) =>
	JSON.stringify({
		issuer: 'https://idp.example/realm',
		authorization_endpoint: 'https://idp.example/realm/authorize',
		token_endpoint: 'https://idp.example/realm/token',
		userinfo_endpoint: 'https://idp.example/realm/userinfo',
		jwks_uri: 'https://idp.example/realm/jwks',
		device_authorization_endpoint: 'https://idp.example/realm/device',
		end_session_endpoint: 'https://idp.example/realm/logout',
		...over
	});

function idpWith(issuer: string): Idp {
	const idp = newIdp();
	idp.issuer = issuer;
	return idp;
}

async function ok(result: Promise<DiscoveryResult>) {
	const r = await result;
	if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
	return r;
}

describe('discover', () => {
	it('REQ-DISC-001 GETs <issuer>/.well-known/openid-configuration without a doubled slash and returns the metadata', async () => {
		const { ipc, calls } = fakeIpc((spec) => exchange(spec, 200, doc()));
		const log = newHttpLog();
		const result = await ok(
			discover(
				ipc,
				idpWith('https://idp.example/realm/'),
				log,
				() => new Date('2026-02-03T04:05:06Z')
			)
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			method: 'GET',
			url: 'https://idp.example/realm/.well-known/openid-configuration'
		});
		expect(result.document.issuer).toBe('https://idp.example/realm');
		expect(result.discoveredAt).toBe('2026-02-03T04:05:06.000Z');
		expect(result.endpoints).toEqual({
			authorization: 'https://idp.example/realm/authorize',
			token: 'https://idp.example/realm/token',
			userinfo: 'https://idp.example/realm/userinfo',
			jwks: 'https://idp.example/realm/jwks',
			deviceAuthorization: 'https://idp.example/realm/device',
			endSession: 'https://idp.example/realm/logout'
		});
		expect(log.exchanges).toHaveLength(1);
	});

	it('REQ-DISC-001 uses the IdP HTTP settings and follows redirects, logging each hop', async () => {
		const idp = idpWith('https://idp.example');
		idp.http.tlsInsecure = true;
		idp.http.headers = [{ name: 'X-Test', value: '1', enabled: true }];
		const { ipc, calls } = fakeIpc((spec, n) =>
			n === 1
				? exchange(spec, 302, '', [
						['Location', 'https://other.example/.well-known/openid-configuration']
					])
				: exchange(spec, 200, doc({ issuer: 'https://idp.example' }))
		);
		const log = newHttpLog();
		await ok(discover(ipc, idp, log));
		expect(calls).toHaveLength(2);
		expect(calls[0].tlsInsecure).toBe(true);
		expect(calls[0].headers).toContainEqual(['X-Test', '1']);
		expect(calls[0].headers).toContainEqual(['Accept', 'application/json']);
		expect(calls[1].url).toBe('https://other.example/.well-known/openid-configuration');
		expect(log.exchanges).toHaveLength(2);
	});

	it('REQ-DISC-002 falls back to the RFC 8414 path-inserted URL on 404 and logs both attempts', async () => {
		const { ipc, calls } = fakeIpc((spec, n) =>
			n === 1 ? exchange(spec, 404, 'nope') : exchange(spec, 200, doc())
		);
		const log = newHttpLog();
		const result = await ok(discover(ipc, idpWith('https://idp.example/realm/'), log));
		expect(calls.map((c) => c.url)).toEqual([
			'https://idp.example/realm/.well-known/openid-configuration',
			'https://idp.example/.well-known/oauth-authorization-server/realm'
		]);
		expect(log.exchanges).toHaveLength(2);
		expect(result.document.issuer).toBe('https://idp.example/realm');
	});

	it('REQ-DISC-002 an issuer without a path falls back to /.well-known/oauth-authorization-server', async () => {
		const { ipc, calls } = fakeIpc((spec, n) =>
			n === 1
				? exchange(spec, 404, '')
				: exchange(spec, 200, doc({ issuer: 'https://idp.example' }))
		);
		await ok(discover(ipc, idpWith('https://idp.example/'), newHttpLog()));
		expect(calls[1].url).toBe('https://idp.example/.well-known/oauth-authorization-server');
	});

	it('REQ-DISC-002 no fallback for non-404 statuses', async () => {
		const { ipc, calls } = fakeIpc((spec) => exchange(spec, 500, 'boom'));
		const result = await discover(ipc, idpWith('https://idp.example'), newHttpLog());
		expect(calls).toHaveLength(1);
		expect(result).toMatchObject({
			ok: false,
			error: { error: 'discovery_http_error', httpStatus: 500 }
		});
	});

	it('REQ-DISC-004 differing issuer yields a warning, not an error; metadata stays usable', async () => {
		const { ipc } = fakeIpc((spec) =>
			exchange(spec, 200, doc({ issuer: 'https://login.other/realm' }))
		);
		const result = await ok(discover(ipc, idpWith('https://idp.example/realm'), newHttpLog()));
		expect(result.warnings).toEqual([
			'Issuer in discovery document (https://login.other/realm) differs from configured issuer (https://idp.example/realm)'
		]);
		expect(result.endpoints.token).toBe('https://idp.example/realm/token');
	});

	it('REQ-DISC-004 equal issuers modulo trailing slash produce no warning', async () => {
		const { ipc } = fakeIpc((spec) =>
			exchange(spec, 200, doc({ issuer: 'https://idp.example/realm/' }))
		);
		const result = await ok(discover(ipc, idpWith('https://idp.example/realm'), newHttpLog()));
		expect(result.warnings).toEqual([]);
	});
});

describe('discover errors', () => {
	const run = async (
		handler: (spec: HttpRequestSpec, n: number) => HttpResult,
		issuer = 'https://idp.example'
	) => {
		const { ipc } = fakeIpc(handler);
		const log = newHttpLog();
		return { result: await discover(ipc, idpWith(issuer), log), log };
	};

	it('REQ-DISC-006 network failure becomes a network RunError carrying the failure kind and message', async () => {
		const { result, log } = await run((spec) => failure(spec, 'dns', 'no such host'));
		expect(result).toEqual({
			ok: false,
			error: { source: 'network', error: 'dns', detail: 'no such host' }
		});
		expect(log.failures).toHaveLength(1);
	});

	it('REQ-DISC-006 TLS failure becomes a tls RunError', async () => {
		const { result } = await run((spec) => failure(spec, 'tls', 'bad cert'));
		expect(result).toEqual({
			ok: false,
			error: { source: 'tls', error: 'tls', detail: 'bad cert' }
		});
	});

	it('REQ-DISC-006 non-JSON body yields discovery_invalid_json with the body excerpt', async () => {
		const { result } = await run((spec) => exchange(spec, 200, '<html>hello</html>'));
		expect(result).toMatchObject({
			ok: false,
			error: { source: 'validation', error: 'discovery_invalid_json', httpStatus: 200 }
		});
		expect(result.ok === false && result.error.detail).toContain('<html>hello</html>');
	});

	it('REQ-DISC-006 JSON that is not an object yields discovery_invalid_document', async () => {
		const { result } = await run((spec) => exchange(spec, 200, '[1,2]'));
		expect(result).toMatchObject({ ok: false, error: { error: 'discovery_invalid_document' } });
	});

	it('REQ-DISC-006 missing issuer yields discovery_missing_issuer', async () => {
		const { result } = await run((spec) => exchange(spec, 200, '{"token_endpoint":"https://x/t"}'));
		expect(result).toMatchObject({
			ok: false,
			error: { source: 'validation', error: 'discovery_missing_issuer' }
		});
	});

	it('REQ-DISC-006 non-2xx after both attempts reports the status and body excerpt', async () => {
		const { result, log } = await run((spec) => exchange(spec, 404, 'x'.repeat(5000)));
		expect(log.exchanges).toHaveLength(2);
		expect(result).toMatchObject({
			ok: false,
			error: { source: 'validation', error: 'discovery_http_error', httpStatus: 404 }
		});
		expect(result.ok === false && result.error.detail).toHaveLength(2048);
	});

	it('REQ-DISC-006 too many redirects is reported as a network error', async () => {
		const { result } = await run((spec) =>
			exchange(spec, 302, '', [['Location', spec.url + '/loop']])
		);
		expect(result).toMatchObject({
			ok: false,
			error: { source: 'network', error: 'too_many_redirects' }
		});
	});

	it('REQ-DISC-006 empty or invalid issuers fail before any request', async () => {
		const empty = fakeIpc((spec) => exchange(spec, 200, doc()));
		expect(await discover(empty.ipc, idpWith('  '), newHttpLog())).toMatchObject({
			ok: false,
			error: { source: 'validation', error: 'missing_issuer' }
		});
		expect(await discover(empty.ipc, idpWith('not a url'), newHttpLog())).toMatchObject({
			ok: false,
			error: { source: 'validation', error: 'invalid_issuer' }
		});
		expect(empty.calls).toHaveLength(0);
	});
});

describe('applyDiscovery', () => {
	const result = async () => {
		const { ipc } = fakeIpc((spec) => exchange(spec, 200, doc()));
		return ok(discover(ipc, idpWith('https://idp.example/realm'), newHttpLog()));
	};

	it('REQ-DISC-003 fills only empty endpoint fields by default', async () => {
		const idp = idpWith('https://idp.example/realm');
		idp.endpoints.token = 'https://custom/token';
		const endpoints = applyDiscovery(idp, await result(), { overwrite: false });
		expect(endpoints.token).toBe('https://custom/token');
		expect(endpoints.authorization).toBe('https://idp.example/realm/authorize');
		expect(endpoints.endSession).toBe('https://idp.example/realm/logout');
		expect(idp.endpoints.authorization).toBe('');
	});

	it('REQ-DISC-003 Apply all overwrites every discovered field and keeps undiscovered ones', async () => {
		const idp = idpWith('https://idp.example/realm');
		idp.endpoints.token = 'https://custom/token';
		idp.endpoints.userinfo = 'https://custom/userinfo';
		const { ipc } = fakeIpc((spec) =>
			exchange(spec, 200, doc({ userinfo_endpoint: undefined, jwks_uri: '' }))
		);
		const partial = await ok(discover(ipc, idp, newHttpLog()));
		idp.endpoints.jwks = 'https://custom/jwks';
		const endpoints = applyDiscovery(idp, partial, { overwrite: true });
		expect(endpoints.token).toBe('https://idp.example/realm/token');
		expect(endpoints.userinfo).toBe('https://custom/userinfo');
		expect(endpoints.jwks).toBe('https://custom/jwks');
	});

	it('REQ-DISC-006 a failed discovery leaves the endpoints unchanged', () => {
		const idp = idpWith('https://idp.example');
		idp.endpoints.token = 'https://custom/token';
		const failed: DiscoveryResult = { ok: false, error: { source: 'network', error: 'dns' } };
		expect(applyDiscovery(idp, failed, { overwrite: true })).toEqual(idp.endpoints);
	});
});

describe('discoverySuggestions', () => {
	it('REQ-DISC-005 extracts the supported-value lists and ignores missing or malformed ones', () => {
		const suggestions = discoverySuggestions({
			grant_types_supported: ['authorization_code', 'refresh_token'],
			response_types_supported: ['code', 'id_token token'],
			scopes_supported: ['openid', 'email'],
			token_endpoint_auth_methods_supported: ['client_secret_basic'],
			code_challenge_methods_supported: ['S256'],
			response_modes_supported: 'query'
		});
		expect(suggestions).toEqual({
			grantTypes: ['authorization_code', 'refresh_token'],
			responseTypes: ['code', 'id_token token'],
			scopes: ['openid', 'email'],
			tokenAuthMethods: ['client_secret_basic'],
			codeChallengeMethods: ['S256'],
			responseModes: []
		});
	});
});

describe('unsupportedWarnings', () => {
	const flow = (type: Flow['type'], responseType?: string) => {
		const f = newFlow(type);
		if (responseType !== undefined) f.params.responseType = responseType;
		return f;
	};

	it('REQ-DISC-005 warns naming the grant type that is not listed', () => {
		const warnings = unsupportedWarnings(flow('client_credentials'), {
			grant_types_supported: ['authorization_code']
		});
		expect(warnings).toEqual([
			'Grant type "client_credentials" is not listed in grant_types_supported'
		]);
	});

	it('REQ-DISC-005 maps device_code to its URN grant type', () => {
		const document = { grant_types_supported: ['authorization_code'] };
		expect(unsupportedWarnings(flow('device_code'), document)).toEqual([
			'Grant type "urn:ietf:params:oauth:grant-type:device_code" is not listed in grant_types_supported'
		]);
		expect(
			unsupportedWarnings(flow('device_code'), {
				grant_types_supported: ['urn:ietf:params:oauth:grant-type:device_code']
			})
		).toEqual([]);
	});

	it('REQ-DISC-005 warns for response_type not listed, comparing token sets regardless of order', () => {
		const document = { response_types_supported: ['code', 'token id_token'] };
		expect(unsupportedWarnings(flow('implicit', 'id_token token'), document)).toEqual([]);
		expect(unsupportedWarnings(flow('hybrid', 'code id_token'), document)).toEqual([
			'response_type "code id_token" is not listed in response_types_supported'
		]);
	});

	it('REQ-DISC-005 front-channel flows are checked for both grant and response_type', () => {
		const warnings = unsupportedWarnings(flow('implicit'), {
			grant_types_supported: ['authorization_code'],
			response_types_supported: ['code']
		});
		expect(warnings).toEqual([
			'Grant type "implicit" is not listed in grant_types_supported',
			'response_type "id_token token" is not listed in response_types_supported'
		]);
	});

	it('REQ-DISC-005 hybrid and PKCE flows need the authorization_code grant', () => {
		const document = { grant_types_supported: ['implicit'] };
		expect(unsupportedWarnings(flow('hybrid'), document)).toEqual([
			'Grant type "authorization_code" is not listed in grant_types_supported'
		]);
		expect(unsupportedWarnings(flow('authorization_code_pkce'), document)).toHaveLength(1);
	});

	it('REQ-DISC-005 no warning when lists are absent, empty-typed or contain the value', () => {
		expect(unsupportedWarnings(flow('authorization_code'), {})).toEqual([]);
		expect(unsupportedWarnings(flow('authorization_code'), { grant_types_supported: 'x' })).toEqual(
			[]
		);
		expect(
			unsupportedWarnings(flow('authorization_code'), {
				grant_types_supported: ['authorization_code'],
				response_types_supported: ['code']
			})
		).toEqual([]);
		expect(unsupportedWarnings(flow('password'), null)).toEqual([]);
	});

	it('REQ-DISC-005 response_type is not checked for back-channel flows', () => {
		const warnings = unsupportedWarnings(flow('client_credentials'), {
			response_types_supported: ['code']
		});
		expect(warnings).toEqual([]);
	});
});
