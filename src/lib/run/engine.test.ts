import { describe, expect, it } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import type {
	AuthWindowArgs,
	AuthWindowResult,
	Header,
	HttpExchange,
	HttpRequestSpec,
	HttpResult
} from '#lib/ipc/types.js';
import { RunSchema } from '#lib/model/run.js';
import {
	newClient,
	newFlow,
	newIdp,
	type Client,
	type Flow,
	type FlowType,
	type Idp
} from '#lib/model/schema.js';
import { challenge } from '#lib/oauth/pkce.js';
import { clientSecretKey, passwordKey } from '#lib/state/secrets.js';
import { createMemoryIpc, type MemoryIpc } from '#lib/testing/memoryIpc.js';
import { callUserInfo, executeRun, type RunContext } from './engine';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const ISSUER = 'https://idp.test';
const REDIRECT = 'http://spoofed.invalid/cb';
const WORKSPACE = 'ws-1';

const never = () => Promise.withResolvers<never>().promise;

interface World {
	ipc: MemoryIpc;
	idp: Idp;
	client: Client;
	flow: Flow;
	requests: HttpRequestSpec[];
	opened: AuthWindowArgs[];
	/** Token endpoint behaviour. */
	token: (spec: HttpRequestSpec, form: URLSearchParams) => { status?: number; body: unknown };
	/** What the popup does with the authorize URL (default: redirect with a code). */
	popup: (args: AuthWindowArgs, authorize: URL) => Promise<AuthWindowResult>;
	jwks: { status: number; body: unknown } | 'failure';
	sign: (claims: Record<string, unknown>) => Promise<string>;
	ctx: (overrides?: Partial<RunContext>) => RunContext;
}

function exchangeOf(spec: HttpRequestSpec, status: number, body: unknown): HttpExchange {
	const headers: Header[] = [['content-type', 'application/json']];
	return {
		id: crypto.randomUUID(),
		startedAt: '2026-01-01T12:00:00Z',
		durationMs: 3,
		request: { method: spec.method, url: spec.url, headers: spec.headers, body: spec.body },
		response: {
			status,
			statusText: '',
			httpVersion: 'HTTP/1.1',
			headers,
			body: typeof body === 'string' ? body : JSON.stringify(body),
			bodyBase64: null
		}
	};
}

/** Redirects back to the flow's redirect URI with the given hash/query built from the authorize URL. */
function callbackUrl(authorize: URL, extra: Record<string, string>, fragment: boolean): string {
	const params = new URLSearchParams({
		...extra,
		state: authorize.searchParams.get('state') ?? ''
	});
	return `${REDIRECT}${fragment ? '#' : '?'}${params}`;
}

async function createWorld(type: FlowType, auth: Client['auth'] = 'client_secret_basic') {
	const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
	const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

	const idp = newIdp('Test IdP');
	idp.issuer = ISSUER;
	idp.endpoints = {
		authorization: `${ISSUER}/authorize`,
		token: `${ISSUER}/token`,
		userinfo: `${ISSUER}/userinfo`,
		jwks: `${ISSUER}/jwks`,
		deviceAuthorization: `${ISSUER}/device`,
		endSession: ''
	};
	const client = newClient('Test client');
	Object.assign(client, { clientId: 'cid', auth, hasSecret: auth !== 'none', jwtAlg: 'HS256' });
	idp.clients.push(client);
	const flow = newFlow(type);
	flow.params.redirectUri = REDIRECT;
	client.flows.push(flow);

	const ipc = createMemoryIpc();
	ipc.secrets.set(clientSecretKey(client.id), 'sec');

	const world: World = {
		ipc,
		idp,
		client,
		flow,
		requests: [],
		opened: [],
		token: () => ({ body: { access_token: 'at', token_type: 'Bearer', expires_in: 3600 } }),
		popup: async (_args, authorize) => ({
			kind: 'captured',
			url: callbackUrl(authorize, { code: 'the-code' }, false),
			navigations: []
		}),
		jwks: { status: 200, body: { keys: [jwk] } },
		sign: (claims) =>
			new SignJWT({
				iss: ISSUER,
				aud: 'cid',
				sub: 'alice',
				iat: NOW / 1000,
				exp: NOW / 1000 + 3600,
				...claims
			})
				.setProtectedHeader({ alg: 'RS256', kid: 'k1' })
				.sign(privateKey),
		ctx: (overrides = {}) => ({
			ipc,
			workspaceId: WORKSPACE,
			idp: world.idp,
			client: world.client,
			flow: world.flow,
			signal: new AbortController().signal,
			now: () => NOW,
			sleep: async () => undefined,
			...overrides
		})
	};

	ipc.onAuthWindowOpen = async (args) => {
		world.opened.push(args);
		return world.popup(args, new URL(args.url));
	};
	ipc.onHttpSend = async (spec): Promise<HttpResult> => {
		world.requests.push(spec);
		const url = new URL(spec.url);
		if (url.pathname === '/jwks') {
			if (world.jwks === 'failure') {
				return {
					ok: false,
					failure: {
						kind: 'connect',
						message: 'connection refused',
						request: { method: spec.method, url: spec.url, headers: spec.headers, body: null }
					}
				};
			}
			return { ok: true, exchange: exchangeOf(spec, world.jwks.status, world.jwks.body) };
		}
		if (url.pathname === '/token') {
			const reply = world.token(spec, new URLSearchParams(spec.body ?? ''));
			return { ok: true, exchange: exchangeOf(spec, reply.status ?? 200, reply.body) };
		}
		return { ok: true, exchange: exchangeOf(spec, 404, { error: 'not_found' }) };
	};
	return world;
}

/** Answers the device authorization endpoint; everything else goes to the previous handler. */
function withDeviceEndpoint(w: World, extra: Record<string, unknown> = {}) {
	const previous = w.ipc.onHttpSend;
	w.ipc.onHttpSend = async (spec) =>
		spec.url.endsWith('/device')
			? {
					ok: true,
					exchange: exchangeOf(spec, 200, {
						device_code: 'dc',
						user_code: 'ABCD-EFGH',
						verification_uri: `${ISSUER}/verify`,
						expires_in: 600,
						...extra
					})
				}
			: previous(spec);
}

const tokenRequests = (w: World) => w.requests.filter((r) => r.url.endsWith('/token'));
const form = (spec: HttpRequestSpec) => new URLSearchParams(spec.body ?? '');
const headerOf = (spec: HttpRequestSpec, name: string) =>
	spec.headers.find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1];
const levels = (run: { validations: Array<{ id: string; level: string }> }) =>
	Object.fromEntries(run.validations.map((v) => [v.id, v.level]));

async function halfHash(value: string): Promise<string> {
	const digest = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
	);
	return Buffer.from(digest.slice(0, 16)).toString('base64url');
}

describe('executeRun: authorization_code', () => {
	it('REQ-FLOW-001 opens the popup with the authorize URL and exchanges the captured code', async () => {
		const w = await createWorld('authorization_code');
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('success');
		expect(w.opened).toHaveLength(1);
		expect(w.opened[0]).toMatchObject({ redirectUri: REDIRECT, cleanSession: false });
		expect(run.authorizeUrl).toBe(w.opened[0].url);

		expect(tokenRequests(w)).toHaveLength(1);
		const [request] = tokenRequests(w);
		const body = form(request);
		expect(body.get('grant_type')).toBe('authorization_code');
		expect(body.get('code')).toBe('the-code');
		expect(body.get('redirect_uri')).toBe(REDIRECT);
		expect(headerOf(request, 'Authorization')).toBe(`Basic ${btoa('cid:sec')}`);
		expect(run.tokens).toMatchObject({
			access_token: 'at',
			token_type: 'Bearer',
			expires_in: 3600
		});
		expect(run.callback?.code).toBe('the-code');
		expect(run.exchanges.map((e) => e.request.url)).toContain(`${ISSUER}/token`);
		expect(RunSchema.safeParse(run).success).toBe(true);
	});

	it('REQ-FLOW-001 an authorization error response ends the run without a token request', async () => {
		const w = await createWorld('authorization_code');
		w.popup = async (_args, authorize) => ({
			kind: 'captured',
			url: callbackUrl(authorize, { error: 'access_denied', error_description: 'nope' }, false),
			navigations: []
		});
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('error');
		expect(run.error).toMatchObject({
			source: 'authorization',
			error: 'access_denied',
			error_description: 'nope'
		});
		expect(tokenRequests(w)).toHaveLength(0);
		expect(run.tokens).toBeUndefined();
	});

	it('REQ-FLOW-001 records the popup navigations and reports a state mismatch', async () => {
		const w = await createWorld('authorization_code');
		const navigations = [{ url: `${ISSUER}/authorize?x=1`, at: '2026-01-01T12:00:00Z' }];
		w.popup = async () => ({
			kind: 'captured',
			url: `${REDIRECT}?code=c&state=forged`,
			navigations
		});
		const run = await executeRun(w.ctx());

		expect(run.navigations).toEqual(navigations);
		expect(run.error).toMatchObject({ source: 'validation', error: 'state_mismatch' });
		expect(tokenRequests(w)).toHaveLength(0);
	});

	it('REQ-FLOW-001 validates the returned ID token: signature, issuer, audience, nonce', async () => {
		const w = await createWorld('authorization_code');
		let idToken = '';
		w.popup = async (_args, authorize) => {
			idToken = await w.sign({ nonce: authorize.searchParams.get('nonce') });
			return {
				kind: 'captured',
				url: callbackUrl(authorize, { code: 'c' }, false),
				navigations: []
			};
		};
		w.token = () => ({ body: { access_token: 'opaque', id_token: idToken } });
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('success');
		const byId = levels(run);
		expect(byId['sig.id_token']).toBe('ok');
		for (const id of ['idt.iss', 'idt.aud', 'idt.exp', 'idt.iat', 'idt.nonce']) {
			expect(byId[id], id).toBe('ok');
		}
		expect(byId['sig.access_token']).toBeUndefined();
		expect(byId['idt.at_hash']).toBeUndefined();
	});
});

describe('executeRun: PKCE', () => {
	it('REQ-FLOW-002 sends a code_challenge and the matching code_verifier', async () => {
		const w = await createWorld('authorization_code_pkce', 'none');
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('success');
		const authorize = new URL(run.authorizeUrl ?? '');
		expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
		const verifier = form(tokenRequests(w)[0]).get('code_verifier');
		expect(verifier).toBeTruthy();
		expect(await challenge(verifier ?? '', 'S256')).toBe(
			authorize.searchParams.get('code_challenge')
		);
	});

	it('REQ-FLOW-002 hybrid with usePkce also sends the verifier', async () => {
		const w = await createWorld('hybrid', 'none');
		w.flow.params.usePkce = true;
		w.flow.params.responseType = 'code token';
		w.popup = async (_args, authorize) => ({
			kind: 'captured',
			url: callbackUrl(authorize, { code: 'c', access_token: 'front' }, true),
			navigations: []
		});
		const run = await executeRun(w.ctx());

		const verifier = form(tokenRequests(w)[0]).get('code_verifier') ?? '';
		expect(await challenge(verifier, 'S256')).toBe(
			new URL(run.authorizeUrl ?? '').searchParams.get('code_challenge')
		);
	});
});

describe('executeRun: implicit', () => {
	it('REQ-FLOW-003 takes tokens from the fragment and never calls the token endpoint', async () => {
		const w = await createWorld('implicit', 'none');
		w.flow.params.responseType = 'id_token token';
		w.popup = async (_args, authorize) => {
			const idToken = await w.sign({
				nonce: authorize.searchParams.get('nonce'),
				at_hash: await halfHash('front-at')
			});
			return {
				kind: 'captured',
				url: callbackUrl(
					authorize,
					{ access_token: 'front-at', id_token: idToken, token_type: 'Bearer', expires_in: '3600' },
					true
				),
				navigations: []
			};
		};
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('success');
		expect(tokenRequests(w)).toHaveLength(0);
		expect(run.exchanges.some((e) => e.request.url.endsWith('/token'))).toBe(false);
		expect(run.tokens).toMatchObject({
			access_token: 'front-at',
			token_type: 'Bearer',
			expires_in: 3600
		});
		expect(run.tokens?.id_token).toBeTruthy();
		const byId = levels(run);
		expect(byId['idt.at_hash']).toBe('ok');
		expect(byId['idt.nonce']).toBe('ok');
		expect(byId['sig.id_token']).toBe('ok');
	});

	it('REQ-FLOW-003 a callback without tokens is a validation error', async () => {
		const w = await createWorld('implicit', 'none');
		w.popup = async (_args, authorize) => ({
			kind: 'captured',
			url: callbackUrl(authorize, {}, true),
			navigations: []
		});
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('error');
		expect(run.error).toMatchObject({ source: 'validation', error: 'missing_tokens' });
	});
});

describe('executeRun: hybrid', () => {
	it('REQ-FLOW-004 keeps the front-channel id_token, exchanges the code and checks c_hash', async () => {
		const w = await createWorld('hybrid', 'none');
		w.flow.params.responseType = 'code id_token';
		w.popup = async (_args, authorize) => {
			const idToken = await w.sign({
				nonce: authorize.searchParams.get('nonce'),
				c_hash: await halfHash('hybrid-code')
			});
			return {
				kind: 'captured',
				url: callbackUrl(authorize, { code: 'hybrid-code', id_token: idToken }, true),
				navigations: []
			};
		};
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('success');
		expect(tokenRequests(w)).toHaveLength(1);
		expect(form(tokenRequests(w)[0]).get('code')).toBe('hybrid-code');
		expect(run.tokens?.access_token).toBe('at');
		expect(run.tokens?.id_token).toBe(run.callback?.id_token);
		const byId = levels(run);
		expect(byId['idt.c_hash']).toBe('ok');
		expect(byId['idt.at_hash']).toBeUndefined();
	});

	it('REQ-FLOW-004 checks c_hash of the front-channel id_token even when the token endpoint returns its own', async () => {
		const w = await createWorld('hybrid', 'none');
		w.flow.params.responseType = 'code id_token';
		let nonce = '';
		w.popup = async (_args, authorize) => {
			nonce = authorize.searchParams.get('nonce') ?? '';
			const idToken = await w.sign({ nonce, c_hash: await halfHash('tampered-elsewhere') });
			return {
				kind: 'captured',
				url: callbackUrl(authorize, { code: 'hybrid-code', id_token: idToken }, true),
				navigations: []
			};
		};
		w.token = () => ({ body: { access_token: 'at', id_token: tokenEndpointIdToken } });
		const tokenEndpointIdToken = await w.sign({ nonce: 'from-token-endpoint' });
		const run = await executeRun(w.ctx());

		expect(run.tokens?.id_token).toBe(tokenEndpointIdToken);
		const cHash = run.validations.filter((v) => v.id === 'idt.c_hash');
		expect(cHash).toHaveLength(1);
		expect(cHash[0].level).toBe('error');
		expect(cHash[0].message).toContain('Front-channel');
		expect(run.validations.filter((v) => v.id === 'idt.iss')).toHaveLength(1);
	});

	it('REQ-FLOW-004 token endpoint values win over front-channel values', async () => {
		const w = await createWorld('hybrid', 'none');
		w.flow.params.responseType = 'code token';
		w.popup = async (_args, authorize) => ({
			kind: 'captured',
			url: callbackUrl(
				authorize,
				{ code: 'c', access_token: 'front-at', token_type: 'bearer' },
				true
			),
			navigations: []
		});
		w.token = () => ({ body: { access_token: 'back-at', token_type: 'Bearer', scope: 'openid' } });
		const run = await executeRun(w.ctx());

		expect(run.tokens).toMatchObject({
			access_token: 'back-at',
			token_type: 'Bearer',
			scope: 'openid'
		});
	});

	it('REQ-FLOW-004 a failing code exchange keeps the front-channel tokens and reports the token error', async () => {
		const w = await createWorld('hybrid', 'none');
		w.flow.params.responseType = 'code token';
		w.popup = async (_args, authorize) => ({
			kind: 'captured',
			url: callbackUrl(authorize, { code: 'c', access_token: 'front-at' }, true),
			navigations: []
		});
		w.token = () => ({ status: 400, body: { error: 'invalid_grant' } });
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('error');
		expect(run.error).toMatchObject({ source: 'token', error: 'invalid_grant', httpStatus: 400 });
		expect(run.tokens?.access_token).toBe('front-at');
	});
});

describe('executeRun: several clients under one IdP', () => {
	it('REQ-FLOW-015 a flow runs with the client that contains it, not another client of the IdP', async () => {
		const w = await createWorld('authorization_code');
		const second = newClient('Second');
		Object.assign(second, {
			clientId: 'cid-2',
			auth: 'client_secret_post',
			hasSecret: true,
			jwtAlg: 'HS256'
		});
		const flow2 = newFlow('authorization_code');
		flow2.params.redirectUri = REDIRECT;
		second.flows.push(flow2);
		w.idp.clients.push(second);
		w.ipc.secrets.set(clientSecretKey(second.id), 'sec-2');

		const run = await executeRun(w.ctx({ client: second, flow: flow2 }));

		expect(run.status).toBe('success');
		expect(new URL(w.opened[0].url).searchParams.get('client_id')).toBe('cid-2');
		const [request] = tokenRequests(w);
		const body = form(request);
		expect(body.get('client_id')).toBe('cid-2');
		expect(body.get('client_secret')).toBe('sec-2');
		expect(headerOf(request, 'Authorization')).toBeUndefined();
		expect(run).toMatchObject({ idpId: w.idp.id, clientId: second.id, flowId: flow2.id });
		expect(run.idpSnapshot.clients.map((c) => c.id)).toContain(second.id);
	});
});

describe('executeRun: back-channel grants', () => {
	it('REQ-FLOW-005 client_credentials sends one token request and opens no popup', async () => {
		const w = await createWorld('client_credentials');
		w.flow.params.scope = 'api.read';
		w.flow.params.audience = 'https://api.test';
		w.flow.params.resource = '';
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('success');
		expect(w.opened).toHaveLength(0);
		expect(tokenRequests(w)).toHaveLength(1);
		const body = form(tokenRequests(w)[0]);
		expect(body.get('grant_type')).toBe('client_credentials');
		expect(body.get('scope')).toBe('api.read');
		expect(body.get('audience')).toBe('https://api.test');
		expect(body.has('resource')).toBe(false);
		expect(run.authorizeUrl).toBeUndefined();
	});

	it('REQ-FLOW-006 password reads the password from the keychain', async () => {
		const w = await createWorld('password');
		w.flow.params.username = 'bob';
		w.ipc.secrets.set(passwordKey(w.flow.id), 'hunter2');
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('success');
		expect(w.opened).toHaveLength(0);
		const body = form(tokenRequests(w)[0]);
		expect(body.get('grant_type')).toBe('password');
		expect(body.get('username')).toBe('bob');
		expect(body.get('password')).toBe('hunter2');
		expect(body.get('scope')).toBe('openid profile email');
	});

	it('REQ-FLOW-007 refresh_token sends the refresh token and omits an empty scope', async () => {
		const w = await createWorld('refresh_token');
		w.flow.params.refreshToken = 'rt-1';
		w.flow.params.scope = '';
		w.token = () => ({ body: { access_token: 'new-at', refresh_token: 'rt-2' } });
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('success');
		const body = form(tokenRequests(w)[0]);
		expect(body.get('grant_type')).toBe('refresh_token');
		expect(body.get('refresh_token')).toBe('rt-1');
		expect(body.has('scope')).toBe(false);
		expect(run.tokens?.refresh_token).toBe('rt-2');
	});

	it('REQ-FLOW-001 a missing client secret fails before any request is sent', async () => {
		const w = await createWorld('client_credentials');
		w.ipc.secrets.clear();
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('error');
		expect(run.error).toMatchObject({ source: 'validation', error: 'missing_client_secret' });
		expect(w.requests).toHaveLength(0);
	});

	it('REQ-FLOW-007 snapshots the flow and IdP so later edits do not change the run', async () => {
		const w = await createWorld('refresh_token');
		w.flow.params.refreshToken = 'rt-1';
		const run = await executeRun(w.ctx());
		w.flow.params.refreshToken = 'edited';
		w.idp.name = 'Edited';

		expect(run.flowSnapshot.params.refreshToken).toBe('rt-1');
		expect(run.idpSnapshot.name).toBe('Test IdP');
		expect(run).toMatchObject({ workspaceId: WORKSPACE, idpId: w.idp.id, flowId: w.flow.id });
	});

	it('REQ-FLOW-001 turns an unexpected exception into a user error instead of throwing', async () => {
		const w = await createWorld('client_credentials');
		w.ipc.onHttpSend = async () => {
			throw new Error('boom');
		};
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('error');
		expect(run.error).toMatchObject({ source: 'user', detail: expect.stringContaining('boom') });
	});
});

describe('executeRun: cancellation and device flow', () => {
	it('REQ-FLOW-012 closing the popup ends the run as cancelled without a token request', async () => {
		const w = await createWorld('authorization_code');
		w.popup = async () => ({ kind: 'closed', navigations: [] });
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('cancelled');
		expect(run.error).toBeUndefined();
		expect(tokenRequests(w)).toHaveLength(0);
	});

	it('REQ-FLOW-012 aborting the signal closes the popup and cancels the run', async () => {
		const w = await createWorld('authorization_code');
		const controller = new AbortController();
		w.popup = () => {
			queueMicrotask(() => controller.abort());
			return never();
		};
		const run = await executeRun(w.ctx({ signal: controller.signal }));

		expect(run.status).toBe('cancelled');
		expect(w.ipc.calls).toContain('authWindowClose');
		expect(tokenRequests(w)).toHaveLength(0);
	});

	it('REQ-FLOW-012 aborting during device polling stops polling and cancels the run', async () => {
		const w = await createWorld('device_code');
		w.popup = never;
		withDeviceEndpoint(w);
		const codes: Array<string | null> = [];
		const controller = new AbortController();
		const run = await executeRun(
			w.ctx({
				signal: controller.signal,
				sleep: never, // never wakes up on its own
				onDeviceCode: (info) => {
					codes.push(info?.userCode ?? null);
					if (info) queueMicrotask(() => controller.abort());
				}
			})
		);

		expect(run.status).toBe('cancelled');
		expect(codes).toEqual(['ABCD-EFGH', null]);
		expect(w.ipc.calls).toContain('authWindowClose');
		expect(tokenRequests(w)).toHaveLength(0);
	});

	it('REQ-FLOW-008 device flow polls until approval and returns the tokens', async () => {
		const w = await createWorld('device_code', 'none');
		w.popup = never;
		withDeviceEndpoint(w);
		let polls = 0;
		w.token = () => {
			polls++;
			return polls < 3
				? { status: 400, body: { error: 'authorization_pending' } }
				: { body: { access_token: 'device-at' } };
		};
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('success');
		expect(polls).toBe(3);
		expect(run.tokens?.access_token).toBe('device-at');
		expect(w.opened[0]).toMatchObject({ url: `${ISSUER}/verify`, redirectUri: null });
	});
});

describe('executeRun: JWKS and signatures', () => {
	it('REQ-JWT-008 fetches the JWKS once per run with the IdP HTTP settings and logs it', async () => {
		const w = await createWorld('client_credentials');
		w.idp.http.tlsInsecure = true;
		w.idp.http.proxy = { mode: 'url', url: 'http://proxy.test:3128' };
		w.idp.http.headers = [{ name: 'X-Custom', value: 'yes', enabled: true }];
		const idToken = await w.sign({});
		const accessToken = await w.sign({ scope: 'api' });
		w.token = () => ({ body: { access_token: accessToken, id_token: idToken } });
		const run = await executeRun(w.ctx());

		const jwksRequests = w.requests.filter((r) => r.url === `${ISSUER}/jwks`);
		expect(jwksRequests).toHaveLength(1);
		expect(jwksRequests[0]).toMatchObject({
			method: 'GET',
			tlsInsecure: true,
			proxy: { mode: 'url', url: 'http://proxy.test:3128' }
		});
		expect(headerOf(jwksRequests[0], 'X-Custom')).toBe('yes');
		expect(run.exchanges.filter((e) => e.request.url === `${ISSUER}/jwks`)).toHaveLength(1);
		const byId = levels(run);
		expect(byId['sig.id_token']).toBe('ok');
		expect(byId['sig.access_token']).toBe('ok');
	});

	it('REQ-JWT-008 a failed JWKS fetch gives a jwks_unavailable warning and is logged as a failure', async () => {
		const w = await createWorld('client_credentials');
		w.jwks = 'failure';
		const idToken = await w.sign({});
		w.token = () => ({ body: { access_token: 'opaque', id_token: idToken } });
		const run = await executeRun(w.ctx());

		expect(run.status).toBe('success');
		const sig = run.validations.find((v) => v.id === 'sig.id_token');
		expect(sig?.level).toBe('warn');
		expect(sig?.message).toContain('JWKS');
		expect(run.failures).toHaveLength(1);
		expect(run.failures[0].kind).toBe('connect');
	});

	it('REQ-JWT-008 without a JWKS endpoint nothing is fetched and the signature is a warning', async () => {
		const w = await createWorld('client_credentials');
		w.idp.endpoints.jwks = '';
		const idToken = await w.sign({});
		w.token = () => ({ body: { access_token: 'opaque', id_token: idToken } });
		const run = await executeRun(w.ctx());

		expect(w.requests.filter((r) => r.url.includes('jwks'))).toHaveLength(0);
		expect(levels(run)['sig.id_token']).toBe('warn');
	});

	it('REQ-JWT-006 an HS256 token is verified with the client secret and needs no JWKS', async () => {
		const w = await createWorld('client_credentials');
		const hs = await new SignJWT({ iss: ISSUER, aud: 'cid', iat: NOW / 1000, exp: NOW / 1000 + 60 })
			.setProtectedHeader({ alg: 'HS256' })
			.sign(new TextEncoder().encode('sec'));
		w.token = () => ({ body: { access_token: 'opaque', id_token: hs } });
		const run = await executeRun(w.ctx());

		expect(levels(run)['sig.id_token']).toBe('ok');
		expect(w.requests.filter((r) => r.url.includes('jwks'))).toHaveLength(0);
	});

	it('REQ-JWT-007 an unsigned token and a tampered token are error-level signature rows', async () => {
		const w = await createWorld('client_credentials');
		const good = await w.sign({});
		const [h, , s] = good.split('.');
		const forged = Buffer.from(JSON.stringify({ iss: ISSUER, aud: 'cid' })).toString('base64url');
		const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x"}').toString('base64url')}.`;
		w.token = () => ({ body: { access_token: unsigned, id_token: `${h}.${forged}.${s}` } });
		const run = await executeRun(w.ctx());

		const byId = levels(run);
		expect(byId['sig.id_token']).toBe('error');
		expect(byId['sig.access_token']).toBe('error');
	});
});

describe('callUserInfo', () => {
	async function userInfoWorld() {
		const w = await createWorld('authorization_code');
		w.idp.http.headers = [{ name: 'X-Custom', value: 'yes', enabled: true }];
		const previous = w.ipc.onHttpSend;
		const reply = { status: 200, body: {} as unknown };
		reply.body = { sub: 'alice' };
		w.ipc.onHttpSend = async (spec) => {
			if (spec.url !== `${ISSUER}/userinfo`) return previous(spec);
			w.requests.push(spec);
			return { ok: true, exchange: exchangeOf(spec, reply.status, reply.body) };
		};
		return { w, reply };
	}

	it('REQ-FLOW-014 sends a GET with the bearer token and returns the exchange and body', async () => {
		const { w } = await userInfoWorld();
		const result = await callUserInfo(w.ctx(), 'the-at');

		expect(result.error).toBeUndefined();
		expect(result.body).toEqual({ sub: 'alice' });
		expect(result.exchange?.request.url).toBe(`${ISSUER}/userinfo`);
		const [request] = w.requests;
		expect(request.method).toBe('GET');
		expect(headerOf(request, 'Authorization')).toBe('Bearer the-at');
		expect(headerOf(request, 'X-Custom')).toBe('yes');
	});

	it('REQ-FLOW-014 reports an OAuth error body and a missing endpoint', async () => {
		const { w, reply } = await userInfoWorld();
		reply.status = 401;
		reply.body = { error: 'invalid_token' };
		const rejected = await callUserInfo(w.ctx(), 'bad');
		expect(rejected.error).toMatchObject({ error: 'invalid_token', httpStatus: 401 });
		expect(rejected.exchange?.response.status).toBe(401);

		w.idp.endpoints.userinfo = '';
		const missing = await callUserInfo(w.ctx(), 'x');
		expect(missing.error).toMatchObject({
			source: 'validation',
			error: 'missing_userinfo_endpoint'
		});
	});

	it('REQ-FLOW-014 a transport failure is returned as failure and error', async () => {
		const { w } = await userInfoWorld();
		w.ipc.onHttpSend = async (spec) => ({
			ok: false,
			failure: {
				kind: 'tls',
				message: 'bad cert',
				request: { method: spec.method, url: spec.url, headers: spec.headers, body: null }
			}
		});
		const result = await callUserInfo(w.ctx(), 'x');

		expect(result.failure?.kind).toBe('tls');
		expect(result.error).toMatchObject({ source: 'tls', error: 'tls', detail: 'bad cert' });
	});
});
