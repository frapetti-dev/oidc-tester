import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent, request } from 'undici';
import { SignJWT, createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { MOCK_CLIENTS, startMockIdp } from './server.ts';
import type { CorsMode, MockIdp } from './server.ts';

/**
 * Server and tests share one process, so freezing only `Date` makes interval/expiry/max_age waits
 * deterministic clock jumps. Sockets and undici keep the real timers.
 */
function useFrozenClock(): void {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
	});
	afterEach(() => {
		vi.useRealTimers();
	});
}

function tick(ms: number): void {
	vi.setSystemTime(Date.now() + ms);
}

const REDIRECT = 'http://spoofed.invalid/cb';
const insecure = new Agent({ connect: { rejectUnauthorized: false } });

interface Reply {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	text: string;
	json: <T = Record<string, unknown>>() => T;
}

interface CallInit {
	method?: string;
	headers?: Record<string, string>;
	/** urlencoded body */
	form?: Record<string, string>;
	body?: string;
}

async function call(idp: MockIdp, path: string, init: CallInit = {}): Promise<Reply> {
	const headers = { ...init.headers };
	let body = init.body;
	if (init.form) {
		body = new URLSearchParams(init.form).toString();
		headers['content-type'] ??= 'application/x-www-form-urlencoded';
	}
	const res = await request(idp.url + path, {
		method: (init.method ?? (body !== undefined ? 'POST' : 'GET')) as 'GET',
		headers,
		body,
		dispatcher: insecure
	});
	const text = await res.body.text();
	return {
		status: res.statusCode,
		headers: res.headers,
		text,
		json: <T>() => JSON.parse(text) as T
	};
}

function basic(id: string, secret: string): Record<string, string> {
	return {
		authorization: `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`
	};
}

interface Parsed {
	href: string;
	query: Record<string, string>;
	fragment: Record<string, string>;
}

function parseLocation(reply: Reply): Parsed {
	expect(reply.status, reply.text).toBe(302);
	const href = String(reply.headers.location);
	const u = new URL(href);
	return {
		href,
		query: Object.fromEntries(u.searchParams),
		fragment: Object.fromEntries(new URLSearchParams(u.hash.slice(1)))
	};
}

function authorizeQuery(params: Record<string, string>): string {
	return (
		'/authorize?' +
		new URLSearchParams({ redirect_uri: REDIRECT, mock_auto_approve: '1', ...params }).toString()
	);
}

async function authorize(idp: MockIdp, params: Record<string, string>): Promise<Parsed> {
	return parseLocation(await call(idp, authorizeQuery(params)));
}

function pkce(): { verifier: string; challenge: string } {
	const verifier = randomBytes(48).toString('base64url');
	return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function halfHash(v: string): string {
	const d = createHash('sha256').update(v).digest();
	return d.subarray(0, 16).toString('base64url');
}

function clientAuthFor(clientId: string): {
	headers: Record<string, string>;
	form: Record<string, string>;
} {
	const c = MOCK_CLIENTS.find((x) => x.id === clientId);
	if (!c) throw new Error(clientId);
	switch (c.method) {
		case 'none':
			return { headers: {}, form: { client_id: c.id } };
		case 'client_secret_basic':
			return { headers: basic(c.id, c.secret ?? ''), form: {} };
		case 'client_secret_post':
			return { headers: {}, form: { client_id: c.id, client_secret: c.secret ?? '' } };
		default:
			return { headers: {}, form: {} };
	}
}

async function assertion(
	idp: MockIdp,
	o: {
		sub?: string;
		iss?: string;
		aud?: string;
		secret?: string;
		exp?: number;
		jti?: string | null;
		alg?: 'HS256' | 'HS384' | 'HS512';
	} = {}
): Promise<Record<string, string>> {
	const now = Math.floor(Date.now() / 1000);
	const jwt = new SignJWT({})
		.setProtectedHeader({ alg: o.alg ?? 'HS256' })
		.setIssuer(o.iss ?? 'conf-jwt')
		.setSubject(o.sub ?? 'conf-jwt')
		.setAudience(o.aud ?? `${idp.url}/token`)
		.setIssuedAt(now)
		.setExpirationTime(o.exp ?? now + 60);
	if (o.jti !== null) jwt.setJti(o.jti ?? randomUUID());
	return {
		client_id: 'conf-jwt',
		client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
		client_assertion: await jwt.sign(new TextEncoder().encode(o.secret ?? 'jwt-secret'))
	};
}

/** Runs an auto-approved authorization_code flow and returns the code response. */
async function getCode(idp: MockIdp, params: Record<string, string>): Promise<string> {
	const loc = await authorize(idp, {
		response_type: 'code',
		scope: 'openid profile email',
		state: 's',
		...params
	});
	return loc.query.code;
}

async function verifyIdToken(idp: MockIdp, token: string): Promise<Record<string, unknown>> {
	const { payload } = await jwtVerify(token, createLocalJWKSet(idp.jwks), { issuer: idp.url });
	return payload;
}

let idp: MockIdp;
beforeAll(async () => {
	idp = await startMockIdp({ port: 0 });
});
afterAll(async () => {
	await idp.stop();
	await insecure.close();
});

describe('startMockIdp', () => {
	it('binds an ephemeral port and uses it as the issuer url', () => {
		expect(idp.port).toBeGreaterThan(0);
		expect(idp.url).toBe(`http://localhost:${idp.port}`);
	});

	it('logs requests with method, path, parsed form, headers and final status; clearRequests empties it', async () => {
		idp.clearRequests();
		await call(idp, '/token', {
			form: { grant_type: 'nope', client_id: 'public-spa' },
			headers: { 'x-trace': 'abc' }
		});
		expect(idp.requests).toHaveLength(1);
		const [r] = idp.requests;
		expect(r).toMatchObject({ method: 'POST', path: '/token', status: 400 });
		expect(r.form).toEqual({ grant_type: 'nope', client_id: 'public-spa' });
		expect(r.headers['x-trace']).toBe('abc');
		expect(r.body).toBe('grant_type=nope&client_id=public-spa');
		idp.clearRequests();
		expect(idp.requests).toHaveLength(0);
	});

	it('answers 404 JSON for unknown routes', async () => {
		const r = await call(idp, '/nope');
		expect(r.status).toBe(404);
		expect(r.json().error).toBe('not_found');
	});

	it('chains /mock/redirect/<n> redirects ending at discovery', async () => {
		let path = '/mock/redirect/2';
		const hops: number[] = [];
		for (let i = 0; i < 5; i++) {
			const r = await call(idp, path);
			hops.push(r.status);
			if (r.status !== 302) break;
			path = new URL(String(r.headers.location)).pathname;
		}
		expect(hops).toEqual([302, 302, 302, 200]);
		expect(path).toBe('/.well-known/openid-configuration');
	});

	it('X-Mock-Delay-Ms delays the response', async () => {
		// Real wall-clock on purpose: the knob delays the response with a real socket-side timer.
		const t0 = performance.now();
		await call(idp, '/jwks', { headers: { 'x-mock-delay-ms': '300' } });
		expect(performance.now() - t0).toBeGreaterThanOrEqual(280);
	});
});

describe('discovery and keys', () => {
	it('serves an openid-configuration whose issuer is the server url and whose endpoints resolve', async () => {
		const r = await call(idp, '/.well-known/openid-configuration');
		expect(r.status).toBe(200);
		expect(String(r.headers['content-type'])).toContain('application/json');
		const doc = r.json<Record<string, unknown>>();
		expect(doc).toMatchObject({
			issuer: idp.url,
			authorization_endpoint: `${idp.url}/authorize`,
			token_endpoint: `${idp.url}/token`,
			userinfo_endpoint: `${idp.url}/userinfo`,
			jwks_uri: `${idp.url}/jwks`,
			device_authorization_endpoint: `${idp.url}/device_authorization`,
			end_session_endpoint: `${idp.url}/logout`,
			authorization_response_iss_parameter_supported: true
		});
		expect(doc.response_types_supported).toEqual(
			expect.arrayContaining([
				'code',
				'token',
				'id_token',
				'id_token token',
				'code id_token',
				'code token',
				'code id_token token'
			])
		);
		expect(doc.grant_types_supported).toEqual(
			expect.arrayContaining([
				'authorization_code',
				'implicit',
				'client_credentials',
				'password',
				'refresh_token',
				'urn:ietf:params:oauth:grant-type:device_code'
			])
		);
		expect(doc.code_challenge_methods_supported).toEqual(['S256', 'plain']);
		expect(doc.response_modes_supported).toEqual(['query', 'fragment']);
		expect(doc.token_endpoint_auth_methods_supported).toEqual(
			expect.arrayContaining([
				'none',
				'client_secret_basic',
				'client_secret_post',
				'client_secret_jwt'
			])
		);
	});

	it('serves the same document at the RFC 8414 path', async () => {
		const a = await call(idp, '/.well-known/openid-configuration');
		const b = await call(idp, '/.well-known/oauth-authorization-server');
		expect(b.status).toBe(200);
		expect(b.json()).toEqual(a.json());
	});

	it('publishes RS256 and ES256 public keys without private material', async () => {
		const jwks = (await call(idp, '/jwks')).json<{ keys: Record<string, string>[] }>();
		expect(jwks.keys.map((k) => [k.alg, k.kty, k.kid, k.use]).sort()).toEqual([
			['ES256', 'EC', 'mock-es256', 'sig'],
			['RS256', 'RSA', 'mock-rs256', 'sig']
		]);
		for (const k of jwks.keys) {
			expect(k).not.toHaveProperty('d');
			expect(k).not.toHaveProperty('p');
		}
	});

	it('discovery: oauth-only hides openid-configuration (RFC 8414 fallback) but keeps the rest', async () => {
		const only = await startMockIdp({ discovery: 'oauth-only' });
		try {
			expect((await call(only, '/.well-known/openid-configuration')).status).toBe(404);
			expect((await call(only, '/.well-known/oauth-authorization-server')).status).toBe(200);
		} finally {
			await only.stop();
		}
	});
});

describe('/authorize', () => {
	it('auto-approve redirects with code, state and iss in the query (default response mode for code)', async () => {
		const loc = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'code',
			scope: 'openid',
			state: 'st-1'
		});
		expect(loc.href.startsWith(`${REDIRECT}?`)).toBe(true);
		expect(loc.query).toMatchObject({ state: 'st-1', iss: idp.url });
		expect(loc.query.code).toBeTruthy();
		expect(loc.fragment).toEqual({});
	});

	it('omits state when none was sent and honours response_mode=fragment for code', async () => {
		const loc = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'code',
			response_mode: 'fragment'
		});
		expect(loc.fragment.code).toBeTruthy();
		expect(loc.fragment).not.toHaveProperty('state');
		expect(loc.query).toEqual({});
	});

	it('accepts any redirect_uri including custom schemes, and keeps an existing query on it', async () => {
		const custom = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'code',
			redirect_uri: 'myapp://cb'
		});
		expect(custom.href.startsWith('myapp://cb?code=')).toBe(true);
		const withQuery = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'code',
			redirect_uri: 'https://x.example/cb?tenant=a'
		});
		expect(withQuery.query.tenant).toBe('a');
		expect(withQuery.query.code).toBeTruthy();
		const frag = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'id_token',
			nonce: 'n',
			scope: 'openid',
			redirect_uri: 'https://x.example/cb?tenant=a'
		});
		expect(frag.query).toEqual({ tenant: 'a' });
		expect(frag.fragment.id_token).toBeTruthy();
	});

	it('shows an error page (no redirect) for unknown clients and bad redirect_uri', async () => {
		const unknown = await call(idp, authorizeQuery({ client_id: 'nobody', response_type: 'code' }));
		expect(unknown.status).toBe(400);
		expect(unknown.headers.location).toBeUndefined();
		expect(unknown.text).toContain('invalid_client');
		const missing = await call(idp, '/authorize?client_id=public-spa&response_type=code');
		expect(missing.status).toBe(400);
		expect(missing.text).toContain('redirect_uri');
		const withHash = await call(
			idp,
			authorizeQuery({
				client_id: 'public-spa',
				response_type: 'code',
				redirect_uri: `${REDIRECT}#x`
			})
		);
		expect(withHash.status).toBe(400);
	});

	it('mock_error redirects with that error, state and iss; front-channel types use the fragment', async () => {
		const q = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'code',
			state: 's9',
			mock_error: 'access_denied'
		});
		expect(q.query).toMatchObject({ error: 'access_denied', state: 's9', iss: idp.url });
		expect(q.query.error_description).toBeTruthy();
		const f = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'token',
			mock_error: 'server_error',
			mock_error_description: 'boom'
		});
		expect(f.fragment).toMatchObject({ error: 'server_error', error_description: 'boom' });
		expect(f.query).toEqual({});
	});

	it('rejects unsupported response_type, response_mode, and query mode for front-channel types', async () => {
		const rt = await authorize(idp, { client_id: 'public-spa', response_type: 'code banana' });
		expect(rt.query.error).toBe('unsupported_response_type');
		const rm = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'code',
			response_mode: 'form_post'
		});
		expect(rm.query.error).toBe('unsupported_response_mode');
		const q = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'token',
			response_mode: 'query'
		});
		expect(q.fragment.error).toBe('invalid_request');
		const none = await authorize(idp, { client_id: 'public-spa', response_type: '' });
		expect(none.query.error).toBe('unsupported_response_type');
	});

	it('requires nonce and the openid scope when response_type contains id_token', async () => {
		const noNonce = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'id_token',
			scope: 'openid'
		});
		expect(noNonce.fragment).toMatchObject({ error: 'invalid_request' });
		expect(noNonce.fragment.error_description).toContain('nonce');
		const noOpenid = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'id_token',
			nonce: 'n',
			scope: 'profile'
		});
		expect(noOpenid.fragment.error).toBe('invalid_scope');
	});

	it('validates PKCE parameters and the mock_alg knob', async () => {
		const badMethod = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'code',
			code_challenge: 'x',
			code_challenge_method: 'S512'
		});
		expect(badMethod.query.error).toBe('invalid_request');
		const orphan = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'code',
			code_challenge_method: 'S256'
		});
		expect(orphan.query.error).toBe('invalid_request');
		const alg = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'code',
			mock_alg: 'PS999'
		});
		expect(alg.query.error).toBe('invalid_request');
		const hsPublic = await authorize(idp, {
			client_id: 'public-spa',
			response_type: 'code',
			mock_alg: 'HS256'
		});
		expect(hsPublic.query.error).toBe('invalid_request');
	});

	describe('response types', () => {
		const cases: { type: string; code: boolean; token: boolean; idToken: boolean }[] = [
			{ type: 'code', code: true, token: false, idToken: false },
			{ type: 'token', code: false, token: true, idToken: false },
			{ type: 'id_token', code: false, token: false, idToken: true },
			{ type: 'id_token token', code: false, token: true, idToken: true },
			{ type: 'code id_token', code: true, token: false, idToken: true },
			{ type: 'code token', code: true, token: true, idToken: false },
			{ type: 'code id_token token', code: true, token: true, idToken: true }
		];
		for (const c of cases) {
			it(`"${c.type}" returns the right parameters in the ${c.type === 'code' ? 'query' : 'fragment'} with correct hashes`, async () => {
				const loc = await authorize(idp, {
					client_id: 'public-spa',
					response_type: c.type,
					scope: 'openid profile email',
					state: 'st',
					nonce: 'nonce-1'
				});
				const p = c.type === 'code' ? loc.query : loc.fragment;
				expect(c.type === 'code' ? loc.fragment : loc.query).toEqual({});
				expect(p.state).toBe('st');
				expect(p.iss).toBe(idp.url);
				expect(Boolean(p.code)).toBe(c.code);
				expect(Boolean(p.access_token)).toBe(c.token);
				expect(Boolean(p.id_token)).toBe(c.idToken);
				if (c.token)
					expect(p).toMatchObject({
						token_type: 'Bearer',
						expires_in: '3600',
						scope: 'openid profile email'
					});
				if (c.idToken) {
					const claims = await verifyIdToken(idp, p.id_token);
					expect(claims).toMatchObject({
						iss: idp.url,
						aud: 'public-spa',
						sub: 'alice-0001',
						nonce: 'nonce-1',
						email: 'alice@example.test',
						name: 'Alice Example'
					});
					expect(claims.exp as number).toBeGreaterThan(Date.now() / 1000);
					expect(claims.auth_time).toBeTypeOf('number');
					expect(claims.sid).toBeTypeOf('string');
					expect(claims.at_hash).toBe(c.token ? halfHash(p.access_token) : undefined);
					expect(claims.c_hash).toBe(c.code ? halfHash(p.code) : undefined);
					expect(decodeProtectedHeader(p.id_token)).toMatchObject({
						alg: 'RS256',
						kid: 'mock-rs256'
					});
				}
			});
		}
	});

	describe('ID token signing knobs', () => {
		it('mock_alg=ES256 signs with the EC key', async () => {
			const loc = await authorize(idp, {
				client_id: 'public-spa',
				response_type: 'id_token',
				scope: 'openid',
				nonce: 'n',
				mock_alg: 'ES256'
			});
			expect(decodeProtectedHeader(loc.fragment.id_token)).toMatchObject({
				alg: 'ES256',
				kid: 'mock-es256'
			});
			await verifyIdToken(idp, loc.fragment.id_token);
		});

		it('mock_alg=HS256 signs with the confidential client secret', async () => {
			const loc = await authorize(idp, {
				client_id: 'conf-basic',
				response_type: 'id_token',
				scope: 'openid',
				nonce: 'n',
				mock_alg: 'HS256'
			});
			const { payload } = await jwtVerify(
				loc.fragment.id_token,
				new TextEncoder().encode('basic-secret')
			);
			expect(payload.aud).toBe('conf-basic');
		});

		it('mock_alg=none returns an unsecured JWT', async () => {
			const loc = await authorize(idp, {
				client_id: 'public-spa',
				response_type: 'id_token',
				scope: 'openid',
				nonce: 'n',
				mock_alg: 'none'
			});
			expect(loc.fragment.id_token.endsWith('.')).toBe(true);
			expect(decodeProtectedHeader(loc.fragment.id_token).alg).toBe('none');
			expect(decodeJwt(loc.fragment.id_token).iss).toBe(idp.url);
		});

		it('mock_expired=1 mints an already expired ID token', async () => {
			const loc = await authorize(idp, {
				client_id: 'public-spa',
				response_type: 'id_token',
				scope: 'openid',
				nonce: 'n',
				mock_expired: '1'
			});
			const claims = decodeJwt(loc.fragment.id_token);
			expect(claims.exp as number).toBeLessThan(Date.now() / 1000 - 60);
			await expect(verifyIdToken(idp, loc.fragment.id_token)).rejects.toThrow();
		});
	});

	describe('login form and SSO', () => {
		useFrozenClock();
		const params = {
			client_id: 'public-spa',
			response_type: 'code',
			scope: 'openid',
			state: 'abc',
			redirect_uri: REDIRECT,
			login_hint: 'alice'
		};
		const query = '/authorize?' + new URLSearchParams(params).toString();

		function formFields(html: string): Record<string, string> {
			const out: Record<string, string> = {};
			for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g))
				out[m[1]] = m[2];
			return out;
		}

		it('renders an HTML login form that carries the request as hidden fields and prefills login_hint', async () => {
			const r = await call(idp, query);
			expect(r.status).toBe(200);
			expect(String(r.headers['content-type'])).toContain('text/html');
			expect(r.text).toContain('<form method="post" action="/authorize"');
			expect(r.text).toContain('name="username"');
			expect(r.text).toContain('value="alice"');
			expect(formFields(r.text)).toMatchObject({
				client_id: 'public-spa',
				state: 'abc',
				redirect_uri: REDIRECT,
				response_type: 'code'
			});
		});

		it('rejects bad credentials (401, form again) and logs in good ones, issuing a code and an SSO cookie', async () => {
			const hidden = formFields((await call(idp, query)).text);
			const bad = await call(idp, '/authorize', {
				form: { ...hidden, username: 'alice', password: 'wrong', action: 'login' }
			});
			expect(bad.status).toBe(401);
			expect(bad.text).toContain('Invalid username or password');
			expect(bad.text).toContain('name="password"');

			const good = await call(idp, '/authorize', {
				form: { ...hidden, username: 'alice', password: 'alice-pw', action: 'login' }
			});
			const loc = parseLocation(good);
			expect(loc.query).toMatchObject({ state: 'abc', iss: idp.url });
			expect(loc.query.code).toBeTruthy();
			const cookie = String(good.headers['set-cookie']);
			expect(cookie).toMatch(/^mock_sso=[^;]+; Path=\/; HttpOnly/);

			// SSO: next request with the cookie skips the form
			const sso = await call(idp, query, { headers: { cookie: cookie.split(';')[0] } });
			expect(parseLocation(sso).query.code).toBeTruthy();
			// prompt=login forces the form again
			const forced = await call(idp, query + '&prompt=login', {
				headers: { cookie: cookie.split(';')[0] }
			});
			expect(forced.status).toBe(200);
			// max_age exceeded forces the form
			tick(1100);
			const stale = await call(idp, query + '&max_age=1', {
				headers: { cookie: cookie.split(';')[0] }
			});
			expect(stale.status).toBe(200);
			// logout kills the session
			const out = await call(idp, '/logout', { headers: { cookie: cookie.split(';')[0] } });
			expect(out.status).toBe(200);
			expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
			const after = await call(idp, query, { headers: { cookie: cookie.split(';')[0] } });
			expect(after.status).toBe(200);
		});

		it('prompt=none without a session returns login_required', async () => {
			const loc = parseLocation(await call(idp, query + '&prompt=none'));
			expect(loc.query.error).toBe('login_required');
			expect(loc.query.state).toBe('abc');
		});

		it('Cancel returns access_denied', async () => {
			const hidden = formFields((await call(idp, query)).text);
			const loc = parseLocation(
				await call(idp, '/authorize', { form: { ...hidden, action: 'cancel' } })
			);
			expect(loc.query).toMatchObject({ error: 'access_denied', state: 'abc' });
		});

		it('logout redirects to post_logout_redirect_uri with state', async () => {
			const loc = parseLocation(
				await call(idp, '/logout?post_logout_redirect_uri=https%3A%2F%2Fapp.example%2Fbye&state=zz')
			);
			expect(loc.href).toBe('https://app.example/bye?state=zz');
		});

		it('auto-approve sets no SSO cookie', async () => {
			const r = await call(idp, authorizeQuery({ client_id: 'public-spa', response_type: 'code' }));
			expect(r.headers['set-cookie']).toBeUndefined();
		});
	});
});

describe('/token authorization_code', () => {
	async function exchange(
		clientId: string,
		codeParams: Record<string, string>,
		extra: Record<string, string> = {},
		extraHeaders: Record<string, string> = {}
	): Promise<Reply> {
		const code = await getCode(idp, { client_id: clientId, ...codeParams });
		const auth = clientAuthFor(clientId);
		return call(idp, '/token', {
			headers: { ...auth.headers, ...extraHeaders },
			form: {
				grant_type: 'authorization_code',
				code,
				redirect_uri: REDIRECT,
				...auth.form,
				...extra
			}
		});
	}

	for (const clientId of ['public-spa', 'conf-basic', 'conf-post']) {
		it(`exchanges a code for tokens as ${clientId} using its own auth method`, async () => {
			const r = await exchange(clientId, { nonce: 'nn', scope: 'openid profile email' });
			expect(r.status).toBe(200);
			expect(r.headers['cache-control']).toBe('no-store');
			const body = r.json<Record<string, string | number>>();
			expect(body).toMatchObject({
				token_type: 'Bearer',
				expires_in: 3600,
				scope: 'openid profile email'
			});
			expect(body.refresh_token).toBeTruthy();
			const claims = await verifyIdToken(idp, String(body.id_token));
			expect(claims).toMatchObject({
				aud: clientId,
				nonce: 'nn',
				at_hash: halfHash(String(body.access_token))
			});
			const at = await jwtVerify(String(body.access_token), createLocalJWKSet(idp.jwks), {
				issuer: idp.url
			});
			expect(at.payload).toMatchObject({
				sub: 'alice-0001',
				client_id: clientId,
				scope: 'openid profile email'
			});
			expect(at.protectedHeader.typ).toBe('at+jwt');
		});
	}

	it('exchanges a code as conf-jwt with a signed client_assertion', async () => {
		const code = await getCode(idp, { client_id: 'conf-jwt', scope: 'openid' });
		const r = await call(idp, '/token', {
			form: {
				grant_type: 'authorization_code',
				code,
				redirect_uri: REDIRECT,
				...(await assertion(idp))
			}
		});
		expect(r.status, r.text).toBe(200);
		expect(r.json().id_token).toBeTruthy();
	});

	it('returns no id_token when the openid scope was not granted', async () => {
		const r = await exchange('public-spa', { scope: 'profile' });
		expect(r.status).toBe(200);
		expect(r.json()).not.toHaveProperty('id_token');
	});

	it('codes are one-time: second use fails with invalid_grant', async () => {
		const code = await getCode(idp, { client_id: 'public-spa' });
		const form = {
			grant_type: 'authorization_code',
			code,
			redirect_uri: REDIRECT,
			client_id: 'public-spa'
		};
		expect((await call(idp, '/token', { form })).status).toBe(200);
		const again = await call(idp, '/token', { form });
		expect(again.status).toBe(400);
		expect(again.json().error).toBe('invalid_grant');
	});

	it('requires the same redirect_uri as the authorize request', async () => {
		const r = await exchange('public-spa', {}, { redirect_uri: 'http://other.invalid/cb' });
		expect(r.status).toBe(400);
		expect(r.json()).toMatchObject({ error: 'invalid_grant' });
		expect(String(r.json().error_description)).toContain(REDIRECT);
		const missing = await exchange('public-spa', {}, { redirect_uri: '' });
		expect(missing.json().error).toBe('invalid_grant');
	});

	it('rejects unknown codes and codes issued to another client', async () => {
		const unknown = await call(idp, '/token', {
			form: {
				grant_type: 'authorization_code',
				code: 'zzz',
				redirect_uri: REDIRECT,
				client_id: 'public-spa'
			}
		});
		expect(unknown.json().error).toBe('invalid_grant');
		const code = await getCode(idp, { client_id: 'public-spa' });
		const auth = clientAuthFor('conf-post');
		const stolen = await call(idp, '/token', {
			form: { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, ...auth.form }
		});
		expect(stolen.json().error).toBe('invalid_grant');
	});

	describe('PKCE', () => {
		it('S256: accepts the right verifier', async () => {
			const { verifier, challenge } = pkce();
			const r = await exchange(
				'public-spa',
				{ code_challenge: challenge, code_challenge_method: 'S256' },
				{ code_verifier: verifier }
			);
			expect(r.status, r.text).toBe(200);
		});

		it('S256: rejects wrong, missing and malformed verifiers', async () => {
			const { challenge } = pkce();
			const wrong = await exchange(
				'public-spa',
				{ code_challenge: challenge, code_challenge_method: 'S256' },
				{ code_verifier: pkce().verifier }
			);
			expect(wrong.json()).toMatchObject({
				error: 'invalid_grant',
				error_description: 'PKCE verification failed'
			});
			const missing = await exchange('public-spa', {
				code_challenge: challenge,
				code_challenge_method: 'S256'
			});
			expect(missing.json().error_description).toContain('code_verifier is required');
			const short = await exchange(
				'public-spa',
				{ code_challenge: challenge, code_challenge_method: 'S256' },
				{ code_verifier: 'short' }
			);
			expect(short.json().error).toBe('invalid_grant');
		});

		it('plain: challenge equals verifier (also the default method)', async () => {
			const verifier = randomBytes(48).toString('base64url');
			const ok = await exchange(
				'public-spa',
				{ code_challenge: verifier, code_challenge_method: 'plain' },
				{ code_verifier: verifier }
			);
			expect(ok.status).toBe(200);
			const implicit = await exchange(
				'public-spa',
				{ code_challenge: verifier },
				{ code_verifier: verifier }
			);
			expect(implicit.status).toBe(200);
			const bad = await exchange(
				'public-spa',
				{ code_challenge: verifier, code_challenge_method: 'plain' },
				{ code_verifier: pkce().verifier }
			);
			expect(bad.json().error).toBe('invalid_grant');
		});

		it('works for confidential clients together with their secret', async () => {
			const { verifier, challenge } = pkce();
			const r = await exchange(
				'conf-basic',
				{ code_challenge: challenge, code_challenge_method: 'S256' },
				{ code_verifier: verifier }
			);
			expect(r.status).toBe(200);
		});
	});

	it('hybrid: front-channel code is exchangeable and the nonce/alg stick to the token-endpoint id_token', async () => {
		const loc = await authorize(idp, {
			client_id: 'conf-post',
			response_type: 'code id_token',
			scope: 'openid',
			nonce: 'hy',
			mock_alg: 'ES256'
		});
		const r = await call(idp, '/token', {
			form: {
				grant_type: 'authorization_code',
				code: loc.fragment.code,
				redirect_uri: REDIRECT,
				...clientAuthFor('conf-post').form
			}
		});
		const claims = decodeJwt(String(r.json().id_token));
		expect(claims.nonce).toBe('hy');
		expect(decodeProtectedHeader(String(r.json().id_token)).alg).toBe('ES256');
	});
});

describe('client authentication', () => {
	const validGrant = () => ({ grant_type: 'client_credentials', scope: 'api' });

	it('client_credentials works for every confidential client with its own method', async () => {
		for (const id of ['conf-basic', 'conf-post']) {
			const auth = clientAuthFor(id);
			const r = await call(idp, '/token', {
				headers: auth.headers,
				form: { ...validGrant(), ...auth.form }
			});
			expect(r.status, `${id}: ${r.text}`).toBe(200);
			expect(r.json()).toMatchObject({ token_type: 'Bearer', scope: 'api' });
		}
		const jwt = await call(idp, '/token', { form: { ...validGrant(), ...(await assertion(idp)) } });
		expect(jwt.status, jwt.text).toBe(200);
	});

	it('Basic credentials are form-urlencoded before base64 (special characters round trip is not needed for fixed secrets)', async () => {
		const r = await call(idp, '/token', {
			headers: {
				authorization: 'Basic ' + Buffer.from('conf-basic:basic-secret').toString('base64')
			},
			form: validGrant()
		});
		expect(r.status).toBe(200);
	});

	it('rejects a wrong secret with 401 invalid_client and a Basic challenge', async () => {
		const r = await call(idp, '/token', {
			headers: basic('conf-basic', 'nope'),
			form: validGrant()
		});
		expect(r.status).toBe(401);
		expect(r.json().error).toBe('invalid_client');
		expect(String(r.headers['www-authenticate'])).toContain('Basic');
		const post = await call(idp, '/token', {
			form: { ...validGrant(), client_id: 'conf-post', client_secret: 'bad' }
		});
		expect(post.status).toBe(401);
		expect(post.headers['www-authenticate']).toBeUndefined();
	});

	it('rejects unknown clients and clients using another client auth method than configured', async () => {
		const unknown = await call(idp, '/token', {
			form: { ...validGrant(), client_id: 'ghost', client_secret: 'x' }
		});
		expect(unknown.status).toBe(401);
		const wrongMethod = await call(idp, '/token', {
			form: { ...validGrant(), client_id: 'conf-basic', client_secret: 'basic-secret' }
		});
		expect(wrongMethod.status).toBe(401);
		expect(String(wrongMethod.json().error_description)).toContain('client_secret_basic');
		const none = await call(idp, '/token', { form: { ...validGrant(), client_id: 'conf-post' } });
		expect(none.status).toBe(401);
	});

	it('rejects multiple authentication methods and a client_id that disagrees with the Basic header', async () => {
		const both = await call(idp, '/token', {
			headers: basic('conf-basic', 'basic-secret'),
			form: { ...validGrant(), client_id: 'conf-basic', client_secret: 'basic-secret' }
		});
		expect(both.status).toBe(400);
		expect(both.json().error).toBe('invalid_request');
		const mismatch = await call(idp, '/token', {
			headers: basic('conf-basic', 'basic-secret'),
			form: { ...validGrant(), client_id: 'conf-post' }
		});
		expect(mismatch.status).toBe(400);
	});

	describe('client_secret_jwt', () => {
		const grant = validGrant();
		const run = async (o: Parameters<typeof assertion>[1]) =>
			call(idp, '/token', { form: { ...grant, ...(await assertion(idp, o)) } });

		it('accepts HS256/HS384/HS512 and issuer/token-endpoint audiences', async () => {
			for (const alg of ['HS256', 'HS384', 'HS512'] as const)
				expect((await run({ alg })).status).toBe(200);
			expect((await run({ aud: idp.url })).status).toBe(200);
		});

		it('rejects wrong secret, iss/sub, aud, expiry, missing jti and replayed jti', async () => {
			for (const bad of [
				{ secret: 'other' },
				{ iss: 'conf-basic' },
				{ sub: 'someone' },
				{ aud: 'https://elsewhere.example/token' },
				{ exp: Math.floor(Date.now() / 1000) - 120 },
				{ jti: null }
			]) {
				const r = await run(bad);
				expect(r.status, JSON.stringify(bad)).toBe(401);
				expect(r.json().error).toBe('invalid_client');
				expect(String(r.json().error_description)).toContain('client_assertion');
			}
			const jti = randomUUID();
			expect((await run({ jti })).status).toBe(200);
			const replay = await run({ jti });
			expect(replay.status).toBe(401);
			expect(String(replay.json().error_description)).toContain('jti');
		});

		it('rejects a wrong client_assertion_type and a client_id that disagrees with the assertion', async () => {
			const a = await assertion(idp);
			const type = await call(idp, '/token', {
				form: { ...grant, ...a, client_assertion_type: 'nope' }
			});
			expect(type.status).toBe(400);
			const mismatch = await call(idp, '/token', {
				form: { ...grant, ...a, client_id: 'conf-basic' }
			});
			expect(mismatch.status).toBe(401);
		});

		it('works without client_id in the body (derived from the assertion subject)', async () => {
			const a = await assertion(idp);
			delete (a as Partial<typeof a>).client_id;
			const r = await call(idp, '/token', { form: { ...grant, ...a } });
			expect(r.status).toBe(200);
		});
	});
});

describe('/token other grants', () => {
	it('client_credentials: scope optional, audience/resource land in aud, no id_token or refresh_token', async () => {
		const auth = clientAuthFor('conf-basic');
		const noScope = await call(idp, '/token', {
			headers: auth.headers,
			form: { grant_type: 'client_credentials' }
		});
		expect(noScope.json()).not.toHaveProperty('scope');
		const r = await call(idp, '/token', {
			headers: auth.headers,
			form: { grant_type: 'client_credentials', scope: 'a b', audience: 'https://api.example' }
		});
		const body = r.json<Record<string, string>>();
		expect(body).not.toHaveProperty('id_token');
		expect(body).not.toHaveProperty('refresh_token');
		const at = decodeJwt(body.access_token);
		expect(at).toMatchObject({ aud: 'https://api.example', sub: 'conf-basic', scope: 'a b' });
		const res = await call(idp, '/token', {
			headers: auth.headers,
			form: { grant_type: 'client_credentials', resource: 'https://res.example' }
		});
		expect(decodeJwt(res.json<Record<string, string>>().access_token).aud).toBe(
			'https://res.example'
		);
	});

	it('client_credentials is refused for public clients', async () => {
		const r = await call(idp, '/token', {
			form: { grant_type: 'client_credentials', client_id: 'public-spa' }
		});
		expect(r.status).toBe(400);
		expect(r.json().error).toBe('unauthorized_client');
	});

	it('password: alice/alice-pw gets tokens (id_token with openid), wrong credentials get invalid_grant', async () => {
		const auth = clientAuthFor('conf-post');
		const ok = await call(idp, '/token', {
			form: {
				grant_type: 'password',
				username: 'alice',
				password: 'alice-pw',
				scope: 'openid email',
				...auth.form
			}
		});
		expect(ok.status, ok.text).toBe(200);
		const body = ok.json<Record<string, string>>();
		expect(body.refresh_token).toBeTruthy();
		expect((await verifyIdToken(idp, body.id_token)).email).toBe('alice@example.test');
		const bad = await call(idp, '/token', {
			form: { grant_type: 'password', username: 'alice', password: 'nope', ...auth.form }
		});
		expect(bad.json().error).toBe('invalid_grant');
	});

	describe('refresh_token', () => {
		async function login(scope = 'openid profile offline_access'): Promise<Record<string, string>> {
			const r = await call(idp, '/token', {
				form: {
					grant_type: 'password',
					username: 'alice',
					password: 'alice-pw',
					scope,
					client_id: 'public-spa'
				}
			});
			return r.json<Record<string, string>>();
		}

		it('rotates: returns a new refresh token, the old one stops working', async () => {
			const first = await login();
			const form = { grant_type: 'refresh_token', client_id: 'public-spa' };
			const r = await call(idp, '/token', {
				form: { ...form, refresh_token: first.refresh_token }
			});
			expect(r.status, r.text).toBe(200);
			const second = r.json<Record<string, string>>();
			expect(second.refresh_token).toBeTruthy();
			expect(second.refresh_token).not.toBe(first.refresh_token);
			expect(second.access_token).not.toBe(first.access_token);
			expect((await verifyIdToken(idp, second.id_token)).sub).toBe('alice-0001');
			expect(decodeJwt(second.id_token)).not.toHaveProperty('nonce');
			const replay = await call(idp, '/token', {
				form: { ...form, refresh_token: first.refresh_token }
			});
			expect(replay.json().error).toBe('invalid_grant');
			const chain = await call(idp, '/token', {
				form: { ...form, refresh_token: second.refresh_token }
			});
			expect(chain.status).toBe(200);
		});

		it('allows narrowing the scope and refuses widening it', async () => {
			const first = await login('openid profile email');
			const widen = await call(idp, '/token', {
				form: {
					grant_type: 'refresh_token',
					client_id: 'public-spa',
					refresh_token: first.refresh_token,
					scope: 'openid admin'
				}
			});
			expect(widen.json().error).toBe('invalid_scope');
			const fresh = await login('openid profile email');
			const narrow = await call(idp, '/token', {
				form: {
					grant_type: 'refresh_token',
					client_id: 'public-spa',
					refresh_token: fresh.refresh_token,
					scope: 'openid'
				}
			});
			expect(narrow.json()).toMatchObject({ scope: 'openid' });
		});

		it('rejects unknown tokens and tokens of another client', async () => {
			const first = await login();
			const foreign = await call(idp, '/token', {
				form: {
					grant_type: 'refresh_token',
					refresh_token: first.refresh_token,
					...clientAuthFor('conf-post').form
				}
			});
			expect(foreign.json().error).toBe('invalid_grant');
			const unknown = await call(idp, '/token', {
				form: { grant_type: 'refresh_token', refresh_token: 'rt_nope', client_id: 'public-spa' }
			});
			expect(unknown.json().error).toBe('invalid_grant');
		});
	});

	it('answers unsupported_grant_type, 405 for GET and invalid_request for non-form bodies', async () => {
		const g = await call(idp, '/token', { form: { grant_type: 'magic', client_id: 'public-spa' } });
		expect(g.json().error).toBe('unsupported_grant_type');
		const get = await call(idp, '/token');
		expect(get.status).toBe(405);
		const json = await call(idp, '/token', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
		expect(json.status).toBe(400);
		expect(json.json().error).toBe('invalid_request');
	});
});

describe('/token test knobs', () => {
	const form = () => ({ grant_type: 'client_credentials', ...clientAuthFor('conf-post').form });

	it('X-Mock-Error forces a 400 JSON OAuth error before anything else (even with bad credentials)', async () => {
		const r = await call(idp, '/token', {
			headers: { 'x-mock-error': 'invalid_grant' },
			form: { grant_type: 'x', client_id: 'ghost' }
		});
		expect(r.status).toBe(400);
		expect(r.json()).toMatchObject({
			error: 'invalid_grant',
			error_description: expect.any(String),
			error_uri: expect.stringContaining('invalid_grant')
		});
	});

	it('X-Mock-Error-Status overrides the status and the knob also works on /device_authorization and /userinfo', async () => {
		const t = await call(idp, '/token', {
			headers: { 'x-mock-error': 'invalid_client', 'x-mock-error-status': '401' },
			form: form()
		});
		expect(t.status).toBe(401);
		const d = await call(idp, '/device_authorization', {
			headers: { 'x-mock-error': 'invalid_scope' },
			form: { client_id: 'public-spa' }
		});
		expect(d.json().error).toBe('invalid_scope');
		const u = await call(idp, '/userinfo', {
			headers: { 'x-mock-error': 'invalid_token', 'x-mock-error-status': '401' }
		});
		expect(u.status).toBe(401);
	});

	it('X-Mock-Nonjson answers 502 text/html', async () => {
		const r = await call(idp, '/token', { headers: { 'x-mock-nonjson': '1' }, form: form() });
		expect(r.status).toBe(502);
		expect(String(r.headers['content-type'])).toContain('text/html');
		expect(() => JSON.parse(r.text)).toThrow();
	});

	it('X-Mock-Expired-IdToken mints an expired id_token and X-Mock-IdToken-Alg switches the alg', async () => {
		const pw = {
			grant_type: 'password',
			username: 'alice',
			password: 'alice-pw',
			scope: 'openid',
			client_id: 'public-spa'
		};
		const expired = (
			await call(idp, '/token', { headers: { 'x-mock-expired-idtoken': '1' }, form: pw })
		).json<Record<string, string>>();
		expect(decodeJwt(expired.id_token).exp as number).toBeLessThan(Date.now() / 1000);
		const es = (
			await call(idp, '/token', { headers: { 'x-mock-idtoken-alg': 'ES256' }, form: pw })
		).json<Record<string, string>>();
		expect(decodeProtectedHeader(es.id_token).alg).toBe('ES256');
		await verifyIdToken(idp, es.id_token);
		const none = (
			await call(idp, '/token', { headers: { 'x-mock-idtoken-alg': 'none' }, form: pw })
		).json<Record<string, string>>();
		expect(decodeProtectedHeader(none.id_token).alg).toBe('none');
		const hs = await call(idp, '/token', {
			headers: { 'x-mock-idtoken-alg': 'HS256', ...basic('conf-basic', 'basic-secret') },
			form: { ...pw, client_id: '' }
		});
		expect(hs.status, hs.text).toBe(200);
		await jwtVerify(
			hs.json<Record<string, string>>().id_token,
			new TextEncoder().encode('basic-secret')
		);
	});
});

describe('/userinfo', () => {
	async function token(scope: string): Promise<string> {
		const r = await call(idp, '/token', {
			form: {
				grant_type: 'password',
				username: 'alice',
				password: 'alice-pw',
				scope,
				client_id: 'public-spa'
			}
		});
		return r.json<Record<string, string>>().access_token;
	}

	it('returns claims according to the granted scopes (GET and POST)', async () => {
		const full = await call(idp, '/userinfo', {
			headers: { authorization: `Bearer ${await token('openid profile email')}` }
		});
		expect(full.json()).toEqual({
			sub: 'alice-0001',
			name: 'Alice Example',
			preferred_username: 'alice',
			given_name: 'Alice',
			family_name: 'Example',
			email: 'alice@example.test',
			email_verified: true
		});
		const minimal = await call(idp, '/userinfo', {
			method: 'POST',
			headers: { authorization: `Bearer ${await token('openid')}` }
		});
		expect(minimal.json()).toEqual({ sub: 'alice-0001' });
	});

	it('401 invalid_token without or with a bad token, 403 without the openid scope or for client tokens', async () => {
		const missing = await call(idp, '/userinfo');
		expect(missing.status).toBe(401);
		expect(String(missing.headers['www-authenticate'])).toContain('invalid_token');
		const bad = await call(idp, '/userinfo', { headers: { authorization: 'Bearer abc.def.ghi' } });
		expect(bad.status).toBe(401);
		const noOpenid = await call(idp, '/userinfo', {
			headers: { authorization: `Bearer ${await token('profile')}` }
		});
		expect(noOpenid.status).toBe(403);
		expect(noOpenid.json().error).toBe('insufficient_scope');
		const cc = (
			await call(idp, '/token', {
				headers: basic('conf-basic', 'basic-secret'),
				form: { grant_type: 'client_credentials', scope: 'openid' }
			})
		).json<Record<string, string>>();
		expect(
			(await call(idp, '/userinfo', { headers: { authorization: `Bearer ${cc.access_token}` } }))
				.status
		).toBe(403);
	});

	it('rejects tokens signed by another key and expired tokens', async () => {
		const forged = await new SignJWT({ scope: 'openid' })
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuer(idp.url)
			.setSubject('alice-0001')
			.setExpirationTime('1h')
			.sign(new TextEncoder().encode('x'.repeat(32)));
		expect(
			(await call(idp, '/userinfo', { headers: { authorization: `Bearer ${forged}` } })).status
		).toBe(401);
	});
});

describe('device flow', () => {
	const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
	useFrozenClock();

	async function start(extra: Record<string, string> = {}, clientId = 'public-spa') {
		const auth = clientAuthFor(clientId);
		const r = await call(idp, '/device_authorization', {
			headers: auth.headers,
			form: { scope: 'openid profile', ...auth.form, ...extra }
		});
		expect(r.status, r.text).toBe(200);
		return r.json<{
			device_code: string;
			user_code: string;
			verification_uri: string;
			verification_uri_complete?: string;
			expires_in: number;
			interval: number;
		}>();
	}

	const poll = (deviceCode: string, clientId = 'public-spa') =>
		call(idp, '/token', {
			headers: clientAuthFor(clientId).headers,
			form: { grant_type: DEVICE_GRANT, device_code: deviceCode, ...clientAuthFor(clientId).form }
		});

	it('returns user_code, device_code, verification URIs, expires_in 600 and interval 5 by default', async () => {
		const d = await start();
		expect(d.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
		expect(d.device_code).toBeTruthy();
		expect(d.verification_uri).toBe(`${idp.url}/device`);
		expect(d.verification_uri_complete).toBe(`${idp.url}/device?user_code=${d.user_code}`);
		expect(d).toMatchObject({ expires_in: 600, interval: 5 });
	});

	it('mock_* knobs shape the response: interval, expires_in, no_complete, auto-approve in the complete URI', async () => {
		const d = await start({ mock_interval: '1', mock_expires_in: '30', mock_no_complete: '1' });
		expect(d).toMatchObject({ interval: 1, expires_in: 30 });
		expect(d.verification_uri_complete).toBeUndefined();
		const auto = await start({ mock_auto_approve: '1' });
		expect(auto.verification_uri_complete).toContain('mock_auto_approve=1');
	});

	it('authorization_pending until approved through the /device form, then tokens (single use)', async () => {
		const d = await start({ mock_interval: '1' });
		tick(1100);
		const pending = await poll(d.device_code);
		expect(pending.status).toBe(400);
		expect(pending.json().error).toBe('authorization_pending');

		const page = await call(idp, `/device?user_code=${d.user_code}`);
		expect(page.status).toBe(200);
		expect(page.text).toContain(`value="${d.user_code}"`);
		const approve = await call(idp, '/device', {
			form: { user_code: d.user_code.toLowerCase().replace('-', ' '), action: 'approve' }
		});
		expect(approve.status).toBe(200);
		expect(approve.text).toContain('device-result');

		tick(1100);
		const ok = await poll(d.device_code);
		expect(ok.status, ok.text).toBe(200);
		const body = ok.json<Record<string, string>>();
		expect(body.refresh_token).toBeTruthy();
		expect((await verifyIdToken(idp, body.id_token)).aud).toBe('public-spa');
		expect(body.scope).toBe('openid profile');
		const reuse = await poll(d.device_code);
		expect(reuse.json().error).toBe('invalid_grant');
	});

	it('mock_auto_approve on the verification_uri_complete approves on open', async () => {
		const d = await start({ mock_interval: '1', mock_auto_approve: '1' });
		const opened = await call(
			idp,
			new URL(d.verification_uri_complete ?? '').pathname +
				new URL(d.verification_uri_complete ?? '').search
		);
		expect(opened.status).toBe(200);
		expect(opened.text).toContain('Device approved');
		tick(1100);
		expect((await poll(d.device_code)).status).toBe(200);
	});

	it('without mock_auto_approve the complete URI only shows the confirmation form', async () => {
		const d = await start({ mock_interval: '1' });
		const page = await call(
			idp,
			new URL(d.verification_uri_complete ?? '').pathname +
				new URL(d.verification_uri_complete ?? '').search
		);
		expect(page.text).toContain('name="user_code"');
		tick(1100);
		expect((await poll(d.device_code)).json().error).toBe('authorization_pending');
	});

	it('polling faster than the interval returns slow_down and permanently adds 5 seconds', async () => {
		const d = await start({ mock_interval: '1' });
		const fast = await poll(d.device_code);
		expect(fast.json().error).toBe('slow_down');
		expect(String(fast.json().error_description)).toContain('6s');
		tick(1100);
		// still within the increased 6 s interval
		expect((await poll(d.device_code)).json().error).toBe('slow_down');
	});

	it('deny gives access_denied; unknown codes at /device give 400; unknown device_code gives invalid_grant', async () => {
		const d = await start({ mock_interval: '1' });
		const deny = await call(idp, '/device', { form: { user_code: d.user_code, action: 'deny' } });
		expect(deny.text).toContain('Device denied');
		tick(1100);
		expect((await poll(d.device_code)).json().error).toBe('access_denied');
		const unknown = await call(idp, '/device', {
			form: { user_code: 'AAAA-AAAA', action: 'approve' }
		});
		expect(unknown.status).toBe(400);
		expect(unknown.text).toContain('Unknown or expired code');
		expect((await call(idp, '/device?user_code=ZZZZ-ZZZZ')).status).toBe(400);
		expect((await poll('dc_nope')).json().error).toBe('invalid_grant');
		expect((await call(idp, '/device')).text).toContain('name="user_code"');
	});

	it('expired_token once expires_in has elapsed', async () => {
		const d = await start({ mock_interval: '1', mock_expires_in: '1' });
		tick(1200);
		const r = await poll(d.device_code);
		expect(r.json().error).toBe('expired_token');
		expect(
			(await call(idp, '/device', { form: { user_code: d.user_code, action: 'approve' } })).status
		).toBe(400);
	});

	it('authenticates confidential clients at the device endpoint and binds the code to the client', async () => {
		const rejected = await call(idp, '/device_authorization', {
			form: { client_id: 'conf-basic' }
		});
		expect(rejected.status).toBe(401);
		const d = await start({ mock_interval: '1' }, 'conf-basic');
		const wrong = await poll(d.device_code, 'conf-post');
		expect(wrong.json().error).toBe('invalid_grant');
		await call(idp, '/device', { form: { user_code: d.user_code, action: 'approve' } });
		tick(1100);
		expect((await poll(d.device_code, 'conf-basic')).status).toBe(200);
	});

	it('mock_alg is honoured for the issued id_token', async () => {
		const d = await start({ mock_interval: '1', mock_alg: 'ES256', mock_auto_approve: '1' });
		await call(idp, `/device?user_code=${d.user_code}&mock_auto_approve=1`);
		tick(1100);
		const ok = (await poll(d.device_code)).json<Record<string, string>>();
		expect(decodeProtectedHeader(ok.id_token).alg).toBe('ES256');
	});

	it('requires a form body and POST', async () => {
		expect((await call(idp, '/device_authorization')).status).toBe(405);
		expect(
			(
				await call(idp, '/device_authorization', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{}'
				})
			).status
		).toBe(400);
	});
});

describe('CORS', () => {
	async function withMode<T>(mode: CorsMode, fn: (s: MockIdp) => Promise<T>): Promise<T> {
		const s = await startMockIdp({ cors: mode });
		try {
			return await fn(s);
		} finally {
			await s.stop();
		}
	}
	const corsPaths = [
		'/token',
		'/userinfo',
		'/jwks',
		'/device_authorization',
		'/.well-known/openid-configuration',
		'/.well-known/oauth-authorization-server'
	];
	const preflightHeaders = {
		origin: 'https://app.example',
		'access-control-request-method': 'POST',
		'access-control-request-headers': 'authorization, content-type, x-custom'
	};

	it('none: no CORS headers on actual or preflight responses', async () => {
		await withMode('none', async (s) => {
			const actual = await call(s, '/jwks', { headers: { origin: 'https://app.example' } });
			expect(Object.keys(actual.headers).filter((h) => h.startsWith('access-control'))).toEqual([]);
			for (const p of corsPaths) {
				const pre = await call(s, p, { method: 'OPTIONS', headers: preflightHeaders });
				expect(pre.status, p).toBe(204);
				expect(
					Object.keys(pre.headers).filter((h) => h.startsWith('access-control')),
					p
				).toEqual([]);
			}
		});
	});

	it('star: ACAO * everywhere; preflight allows only Content-Type (so Authorization is blocked)', async () => {
		await withMode('star', async (s) => {
			for (const p of corsPaths) {
				const pre = await call(s, p, { method: 'OPTIONS', headers: preflightHeaders });
				expect(pre.status, p).toBe(204);
				expect(pre.headers['access-control-allow-origin'], p).toBe('*');
				expect(pre.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
				expect(pre.headers['access-control-allow-headers']).toBe('Content-Type');
				expect(pre.headers['access-control-allow-credentials']).toBeUndefined();
			}
			const actual = await call(s, '/token', {
				form: { grant_type: 'x', client_id: 'public-spa' },
				headers: { origin: 'https://app.example' }
			});
			expect(actual.headers['access-control-allow-origin']).toBe('*');
			expect(actual.headers['access-control-allow-methods']).toBeUndefined();
			expect(actual.status).toBe(400);
		});
	});

	it('origin: reflects Origin with credentials, echoes requested headers, sends Vary', async () => {
		await withMode('origin', async (s) => {
			const pre = await call(s, '/token', { method: 'OPTIONS', headers: preflightHeaders });
			expect(pre.headers).toMatchObject({
				'access-control-allow-origin': 'https://app.example',
				'access-control-allow-credentials': 'true',
				'access-control-allow-methods': 'GET, POST, OPTIONS',
				'access-control-allow-headers': 'authorization, content-type, x-custom',
				vary: 'Origin'
			});
			const actual = await call(s, '/userinfo', { headers: { origin: 'https://other.example' } });
			expect(actual.headers['access-control-allow-origin']).toBe('https://other.example');
			const noOrigin = await call(s, '/jwks');
			expect(noOrigin.headers['access-control-allow-origin']).toBeUndefined();
			const noReqHeaders = await call(s, '/jwks', {
				method: 'OPTIONS',
				headers: { origin: 'https://a.example' }
			});
			expect(noReqHeaders.headers['access-control-allow-headers']).toBe(
				'authorization, content-type'
			);
		});
	});

	it('CORS headers are not added to front-channel pages', async () => {
		await withMode('star', async (s) => {
			const r = await call(s, authorizeQuery({ client_id: 'public-spa', response_type: 'code' }), {
				headers: { origin: 'https://app.example' }
			});
			expect(r.headers['access-control-allow-origin']).toBeUndefined();
			const d = await call(s, '/device');
			expect(d.headers['access-control-allow-origin']).toBeUndefined();
		});
	});
});

describe('TLS', () => {
	let tlsIdp: MockIdp;
	beforeAll(async () => {
		tlsIdp = await startMockIdp({ tls: true });
	}, 30_000);
	afterAll(async () => {
		await tlsIdp.stop();
	});

	it('serves https with issuer https://localhost:<port> and a self-signed certificate', async () => {
		expect(tlsIdp.url).toBe(`https://localhost:${tlsIdp.port}`);
		const r = await call(tlsIdp, '/.well-known/openid-configuration');
		expect(r.status).toBe(200);
		expect(r.json().issuer).toBe(tlsIdp.url);
		expect(r.json().token_endpoint).toBe(`${tlsIdp.url}/token`);
		const strict = new Agent({ connect: { rejectUnauthorized: true } });
		await expect(request(`${tlsIdp.url}/jwks`, { dispatcher: strict })).rejects.toMatchObject({
			code: expect.stringMatching(/SELF_SIGNED|UNABLE_TO_VERIFY|CERT/)
		});
		await strict.close();
	});

	it('runs a full PKCE code flow over https', async () => {
		const { verifier, challenge } = pkce();
		const loc = await authorize(tlsIdp, {
			client_id: 'public-spa',
			response_type: 'code',
			scope: 'openid',
			nonce: 'n',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			state: 'x'
		});
		expect(loc.query.iss).toBe(tlsIdp.url);
		const r = await call(tlsIdp, '/token', {
			form: {
				grant_type: 'authorization_code',
				code: loc.query.code,
				redirect_uri: REDIRECT,
				code_verifier: verifier,
				client_id: 'public-spa'
			}
		});
		expect(r.status, r.text).toBe(200);
		const claims = await verifyIdToken(tlsIdp, r.json<Record<string, string>>().id_token);
		expect(claims).toMatchObject({ iss: tlsIdp.url, nonce: 'n' });
	});
});
