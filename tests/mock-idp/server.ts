/**
 * Mock OAuth2 / OpenID Connect provider for OIDC Tester development and tests.
 *
 * Run standalone:   pnpm mock-idp   (http://localhost:4455 and https://localhost:4456, self-signed)
 *   options:        --cors=none|star|origin  --http-port=4455  --https-port=4456
 * Use from tests:   const idp = await startMockIdp({ port: 0, tls: false, cors: 'none' });
 *                   idp.url (= issuer), idp.requests (request log), await idp.stop()
 *
 * Fixtures
 *   user      alice / alice-pw   (sub "alice-0001")
 *   clients   public-spa (auth none)
 *             conf-basic  / basic-secret  (client_secret_basic)
 *             conf-post   / post-secret   (client_secret_post)
 *             conf-jwt    / jwt-secret    (client_secret_jwt, HS256/384/512; aud = token endpoint or issuer)
 *   A client only accepts its own authentication method (anything else -> 401 invalid_client).
 *   Any redirect_uri is accepted on /authorize (spoofing is the point); /token requires the same value.
 *
 * Endpoints
 *   /.well-known/openid-configuration, /.well-known/oauth-authorization-server, /jwks (RS256 + ES256),
 *   /authorize (GET/POST), /token, /userinfo, /device_authorization, /device, /logout,
 *   /mock/redirect/<n>  (n chained 302s, then 302 to the discovery document)
 *
 * Test knobs
 *   /authorize query (and /device_authorization form body for mock_alg-less ones are ignored):
 *     mock_auto_approve=1     skip the login form, redirect immediately (no SSO cookie is set)
 *     mock_error=<code>       redirect with error=<code> (mock_error_description optional)
 *     mock_alg=RS256|ES256|HS256|none   ID token signature (HS256 = client secret, confidential clients only)
 *     mock_expired=1          mint an already expired ID token
 *   /device_authorization form body:
 *     mock_auto_approve=1     verification_uri_complete carries mock_auto_approve=1 (auto-approve on open)
 *     mock_interval=<s>       polling interval (default 5)   mock_expires_in=<s>  lifetime (default 600)
 *     mock_no_complete=1      omit verification_uri_complete   mock_alg=...  ID token alg for the issued tokens
 *   Request headers (any of /token, /device_authorization, /userinfo unless noted):
 *     X-Mock-Error: <code>          respond JSON {error, error_description, error_uri} (status 400, or
 *                                   X-Mock-Error-Status) before doing anything else
 *     X-Mock-Expired-IdToken: 1     (/token) mint an already expired ID token
 *     X-Mock-IdToken-Alg: <alg>     (/token) override the ID token alg (same values as mock_alg)
 *     X-Mock-Nonjson: 1             (/token) respond 502 text/html
 *     X-Mock-Delay-Ms: <ms>         (every endpoint) delay the response (timeout tests)
 *   SSO: a successful form login sets cookie mock_sso; later /authorize calls skip the form unless
 *   prompt=login (or max_age exceeded); prompt=none without a session -> login_required.
 *   Options: cors 'none' (no CORS headers), 'star' (ACAO *, ACAH only Content-Type), 'origin'
 *   (reflect Origin, credentials true, reflect requested headers) on /token /userinfo /jwks
 *   /device_authorization /.well-known/*; discovery 'oauth-only' makes the openid-configuration
 *   document 404 so the RFC 8414 fallback can be tested.
 *   idp.requests logs every request (method, path, headers lower-cased, raw body, parsed form, status).
 */
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server as HttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
	SignJWT,
	UnsecuredJWT,
	decodeProtectedHeader,
	exportJWK,
	generateKeyPair,
	jwtVerify
} from 'jose';
import type { GenerateKeyPairResult, JWK } from 'jose';
import { generate as generateCert } from 'selfsigned';

export type CorsMode = 'none' | 'star' | 'origin';

export interface MockIdpOptions {
	/** 0 (default) = ephemeral. */
	port?: number;
	tls?: boolean;
	cors?: CorsMode;
	/** 'oauth-only': /.well-known/openid-configuration returns 404. */
	discovery?: 'both' | 'oauth-only';
}

export interface LoggedRequest {
	method: string;
	path: string;
	/** Path + query. */
	url: string;
	headers: Record<string, string>;
	body: string;
	/** Parsed application/x-www-form-urlencoded body, else null. */
	form: Record<string, string> | null;
	/** Response status once finished. */
	status: number | null;
	at: string;
}

export interface MockIdp {
	/** Base URL = issuer, e.g. http://localhost:4455 */
	url: string;
	port: number;
	requests: LoggedRequest[];
	jwks: { keys: JWK[] };
	clearRequests(): void;
	stop(): Promise<void>;
}

export const MOCK_USER = {
	username: 'alice',
	password: 'alice-pw',
	sub: 'alice-0001',
	name: 'Alice Example',
	givenName: 'Alice',
	familyName: 'Example',
	email: 'alice@example.test'
} as const;

type ClientAuthMethod = 'none' | 'client_secret_basic' | 'client_secret_post' | 'client_secret_jwt';

interface MockClient {
	id: string;
	secret: string | null;
	method: ClientAuthMethod;
}

export const MOCK_CLIENTS: readonly MockClient[] = [
	{ id: 'public-spa', secret: null, method: 'none' },
	{ id: 'conf-basic', secret: 'basic-secret', method: 'client_secret_basic' },
	{ id: 'conf-post', secret: 'post-secret', method: 'client_secret_post' },
	{ id: 'conf-jwt', secret: 'jwt-secret', method: 'client_secret_jwt' }
];

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const JWT_BEARER_ASSERTION = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const ACCESS_TOKEN_TTL = 3600;
const CODE_TTL_MS = 60_000;
const CORS_PATHS = new Set([
	'/token',
	'/userinfo',
	'/jwks',
	'/device_authorization',
	'/.well-known/openid-configuration',
	'/.well-known/oauth-authorization-server'
]);
const ID_TOKEN_ALGS = new Set(['RS256', 'ES256', 'HS256', 'none']);
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

type Form = Record<string, string>;
type KeyPair = GenerateKeyPairResult;

interface AuthCode {
	clientId: string;
	redirectUri: string;
	scope: string;
	sub: string;
	nonce: string | null;
	authTime: number;
	sid: string;
	challenge: string | null;
	challengeMethod: string;
	alg: string;
	expiresAt: number;
}

interface RefreshRecord {
	clientId: string;
	scope: string;
	sub: string;
	authTime: number;
	sid: string;
	alg: string;
}

interface DeviceRecord {
	deviceCode: string;
	userCode: string;
	clientId: string;
	scope: string;
	alg: string;
	status: 'pending' | 'approved' | 'denied';
	interval: number;
	lastPoll: number;
	expiresAt: number;
}

interface Session {
	sid: string;
	sub: string;
	authTime: number;
}

function firstValues(params: URLSearchParams): Form {
	const out: Form = {};
	for (const [k, v] of params) if (!(k in out)) out[k] = v;
	return out;
}

function esc(s: string): string {
	return s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function randomToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}

function halfHash(value: string): string {
	const digest = createHash('sha256').update(value, 'ascii').digest();
	return digest.subarray(0, digest.length / 2).toString('base64url');
}

function sha256b64url(value: string): string {
	return createHash('sha256').update(value, 'ascii').digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
	const ba = Buffer.from(a);
	const bb = Buffer.from(b);
	return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function formDecode(s: string): string {
	return decodeURIComponent(s.replaceAll('+', ' '));
}

function parseCookies(header: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of (header ?? '').split(';')) {
		const i = part.indexOf('=');
		if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
	}
	return out;
}

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

function scopeList(scope: string): string[] {
	return scope.split(/\s+/).filter(Boolean);
}

function readBody(req: IncomingMessage): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const chunks: Buffer[] = [];
	let size = 0;
	req.on('data', (c: Buffer) => {
		size += c.length;
		if (size > 1_048_576) {
			reject(new Error('body too large'));
			req.destroy();
			return;
		}
		chunks.push(c);
	});
	req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
	req.on('error', reject);
	return promise;
}

function header(req: IncomingMessage, name: string): string | undefined {
	const v = req.headers[name];
	return Array.isArray(v) ? v.join(', ') : v;
}

export async function startMockIdp(options: MockIdpOptions = {}): Promise<MockIdp> {
	const cors: CorsMode = options.cors ?? 'none';
	const tls = options.tls ?? false;
	const oauthOnly = options.discovery === 'oauth-only';

	const rsa = await generateKeyPair('RS256');
	const ec = await generateKeyPair('ES256');
	const signingKeys: Record<string, { kid: string; pair: KeyPair }> = {
		RS256: { kid: 'mock-rs256', pair: rsa },
		ES256: { kid: 'mock-es256', pair: ec }
	};
	const jwks: { keys: JWK[] } = {
		keys: await Promise.all(
			Object.entries(signingKeys).map(async ([alg, { kid, pair }]) => ({
				...(await exportJWK(pair.publicKey)),
				kid,
				alg,
				use: 'sig'
			}))
		)
	};

	const codes = new Map<string, AuthCode>();
	const refreshTokens = new Map<string, RefreshRecord>();
	const devices = new Map<string, DeviceRecord>(); // by device_code
	const sessions = new Map<string, Session>();
	const usedAssertionIds = new Set<string>();
	const requests: LoggedRequest[] = [];
	let origin = '';

	// ---------------------------------------------------------------- token minting

	async function mintAccessToken(o: {
		sub: string;
		clientId: string;
		scope: string;
		audience?: string;
	}): Promise<string> {
		const now = Math.floor(Date.now() / 1000);
		return new SignJWT({
			scope: o.scope,
			client_id: o.clientId
		})
			.setProtectedHeader({ alg: 'RS256', kid: signingKeys.RS256.kid, typ: 'at+jwt' })
			.setIssuer(origin)
			.setSubject(o.sub)
			.setAudience(o.audience || 'mock-api')
			.setIssuedAt(now)
			.setExpirationTime(now + ACCESS_TOKEN_TTL)
			.setJti(randomUUID())
			.sign(rsa.privateKey);
	}

	async function mintIdToken(o: {
		client: MockClient;
		sub: string;
		scope: string;
		nonce: string | null;
		authTime: number;
		sid: string;
		alg: string;
		expired: boolean;
		accessToken?: string;
		code?: string;
	}): Promise<string> {
		const now = Math.floor(Date.now() / 1000);
		const scopes = scopeList(o.scope);
		const claims: Record<string, unknown> = {
			iss: origin,
			sub: o.sub,
			aud: o.client.id,
			iat: o.expired ? now - 7200 : now,
			exp: o.expired ? now - 3600 : now + ACCESS_TOKEN_TTL,
			auth_time: Math.floor(o.authTime / 1000),
			sid: o.sid
		};
		if (o.nonce) claims.nonce = o.nonce;
		if (o.accessToken) claims.at_hash = halfHash(o.accessToken);
		if (o.code) claims.c_hash = halfHash(o.code);
		if (scopes.includes('profile')) {
			claims.name = MOCK_USER.name;
			claims.preferred_username = MOCK_USER.username;
			claims.given_name = MOCK_USER.givenName;
			claims.family_name = MOCK_USER.familyName;
		}
		if (scopes.includes('email')) {
			claims.email = MOCK_USER.email;
			claims.email_verified = true;
		}
		if (o.alg === 'none') return new UnsecuredJWT(claims).encode();
		if (o.alg === 'HS256') {
			return new SignJWT(claims)
				.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
				.sign(new TextEncoder().encode(o.client.secret ?? ''));
		}
		const key = signingKeys[o.alg] ?? signingKeys.RS256;
		return new SignJWT(claims)
			.setProtectedHeader({ alg: signingKeys[o.alg] ? o.alg : 'RS256', kid: key.kid, typ: 'JWT' })
			.sign(key.pair.privateKey);
	}

	function newRefreshToken(rec: RefreshRecord): string {
		const token = `rt_${randomToken(24)}`;
		refreshTokens.set(token, rec);
		return token;
	}

	// ---------------------------------------------------------------- response helpers

	function send(
		res: ServerResponse,
		status: number,
		contentType: string,
		body: string,
		extra: Record<string, string | string[]> = {}
	): void {
		res.writeHead(status, {
			'content-type': contentType,
			'cache-control': 'no-store',
			...extra
		});
		res.end(body);
	}

	function json(
		res: ServerResponse,
		status: number,
		body: unknown,
		extra: Record<string, string | string[]> = {}
	): void {
		send(res, status, 'application/json; charset=utf-8', JSON.stringify(body), extra);
	}

	function html(
		res: ServerResponse,
		status: number,
		title: string,
		bodyHtml: string,
		extra: Record<string, string | string[]> = {}
	): void {
		send(
			res,
			status,
			'text/html; charset=utf-8',
			`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>` +
				'<meta name="viewport" content="width=device-width, initial-scale=1">' +
				'<style>body{font-family:system-ui,sans-serif;max-width:26rem;margin:3rem auto;padding:0 1rem}' +
				'label{display:block;margin:.75rem 0 .25rem}input{width:100%;padding:.4rem;box-sizing:border-box}' +
				'button{margin:1rem .5rem 0 0;padding:.4rem 1rem}.error{color:#b00020}small{color:#666}</style>' +
				`</head><body><h1>${esc(title)}</h1>${bodyHtml}</body></html>`,
			extra
		);
	}

	function redirect(
		res: ServerResponse,
		location: string,
		extra: Record<string, string> = {}
	): void {
		res.writeHead(302, { location, 'cache-control': 'no-store', ...extra });
		res.end();
	}

	function oauthError(
		res: ServerResponse,
		status: number,
		error: string,
		description: string,
		extra: Record<string, string | string[]> = {}
	): void {
		json(res, status, { error, error_description: description }, { pragma: 'no-cache', ...extra });
	}

	function applyCors(req: IncomingMessage, res: ServerResponse, preflight: boolean): void {
		if (cors === 'none') return;
		const reqOrigin = header(req, 'origin');
		if (cors === 'star') {
			res.setHeader('access-control-allow-origin', '*');
			if (preflight) {
				res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
				res.setHeader('access-control-allow-headers', 'Content-Type');
				res.setHeader('access-control-max-age', '600');
			}
			return;
		}
		res.setHeader('vary', 'Origin');
		if (reqOrigin) {
			res.setHeader('access-control-allow-origin', reqOrigin);
			res.setHeader('access-control-allow-credentials', 'true');
		}
		if (preflight) {
			res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
			res.setHeader(
				'access-control-allow-headers',
				header(req, 'access-control-request-headers') ?? 'authorization, content-type'
			);
			res.setHeader('access-control-max-age', '600');
		}
	}

	// ---------------------------------------------------------------- client authentication

	type ClientAuthResult =
		| { ok: true; client: MockClient }
		| { ok: false; status: number; error: string; description: string; basic: boolean };

	async function authenticateClient(req: IncomingMessage, form: Form): Promise<ClientAuthResult> {
		const authz = header(req, 'authorization');
		const hasBasic = !!authz && /^basic\s/i.test(authz);
		const hasPost = 'client_secret' in form;
		const hasJwt = 'client_assertion' in form;
		if ([hasBasic, hasPost, hasJwt].filter(Boolean).length > 1) {
			return {
				ok: false,
				status: 400,
				error: 'invalid_request',
				description: 'More than one client authentication method was used',
				basic: hasBasic
			};
		}
		const fail = (description: string, status = 401): ClientAuthResult => ({
			ok: false,
			status,
			error: 'invalid_client',
			description,
			basic: hasBasic
		});
		let clientId = form.client_id ?? '';
		let presented: ClientAuthMethod = 'none';
		let secret = '';
		if (hasBasic) {
			presented = 'client_secret_basic';
			const decoded = Buffer.from(authz.slice(6).trim(), 'base64').toString('utf8');
			const i = decoded.indexOf(':');
			if (i < 0) return fail('Malformed Basic credentials');
			try {
				const basicId = formDecode(decoded.slice(0, i));
				secret = formDecode(decoded.slice(i + 1));
				if (clientId && clientId !== basicId) {
					return {
						ok: false,
						status: 400,
						error: 'invalid_request',
						description: 'client_id does not match the Authorization header',
						basic: true
					};
				}
				clientId = basicId;
			} catch {
				return fail('Malformed Basic credentials (not form-urlencoded)');
			}
		} else if (hasPost) {
			presented = 'client_secret_post';
			secret = form.client_secret;
		} else if (hasJwt) {
			presented = 'client_secret_jwt';
		}
		let assertion: string | null = null;
		if (hasJwt) {
			if (form.client_assertion_type !== JWT_BEARER_ASSERTION) {
				return fail('client_assertion_type must be ' + JWT_BEARER_ASSERTION, 400);
			}
			assertion = form.client_assertion;
			if (!clientId) {
				try {
					const part = assertion.split('.')[1] ?? '';
					const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as {
						sub?: string;
					};
					clientId = payload.sub ?? '';
				} catch {
					return fail('Malformed client_assertion');
				}
			}
		}
		const client = MOCK_CLIENTS.find((c) => c.id === clientId);
		if (!client) return fail(`Unknown client "${clientId}"`);
		if (client.method !== presented) {
			return fail(
				`Client "${client.id}" must authenticate with ${client.method} (got ${presented})`
			);
		}
		if (client.secret !== null) {
			if (assertion !== null) {
				try {
					const alg = decodeProtectedHeader(assertion).alg ?? '';
					if (!['HS256', 'HS384', 'HS512'].includes(alg)) return fail('Unsupported assertion alg');
					const { payload } = await jwtVerify(assertion, new TextEncoder().encode(client.secret), {
						issuer: client.id,
						subject: client.id,
						audience: [`${origin}/token`, origin, `${origin}/device_authorization`],
						algorithms: ['HS256', 'HS384', 'HS512'],
						requiredClaims: ['iss', 'sub', 'aud', 'exp', 'jti']
					});
					const jti = String(payload.jti);
					if (usedAssertionIds.has(jti)) return fail('client_assertion jti was already used');
					usedAssertionIds.add(jti);
				} catch (err) {
					return fail(`Invalid client_assertion: ${(err as Error).message}`);
				}
			} else if (!safeEqual(secret, client.secret)) {
				return fail('Invalid client secret');
			}
		}
		return { ok: true, client };
	}

	// ---------------------------------------------------------------- /authorize

	function loginForm(params: Form, error: string | null): string {
		const hidden = Object.entries(params)
			.filter(([k]) => !['username', 'password', 'action'].includes(k))
			.map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
			.join('');
		return (
			(error ? `<p class="error" id="login-error">${esc(error)}</p>` : '') +
			`<form method="post" action="/authorize" id="login-form">${hidden}` +
			'<label for="username">Username</label>' +
			`<input id="username" name="username" autocomplete="username" value="${esc(params.login_hint ?? '')}">` +
			'<label for="password">Password</label>' +
			'<input id="password" name="password" type="password" autocomplete="current-password">' +
			'<button type="submit" name="action" value="login">Sign in</button>' +
			'<button type="submit" name="action" value="cancel">Cancel</button>' +
			'</form>' +
			`<p><small>Mock IdP &mdash; try ${MOCK_USER.username} / ${MOCK_USER.password}</small></p>`
		);
	}

	async function authorize(
		req: IncomingMessage,
		res: ServerResponse,
		url: URL,
		form: Form | null
	): Promise<void> {
		const isPost = req.method === 'POST';
		const p: Form = isPost ? (form ?? {}) : firstValues(url.searchParams);
		const client = MOCK_CLIENTS.find((c) => c.id === p.client_id);
		if (!client) {
			return html(
				res,
				400,
				'Authorization error',
				`<p class="error">invalid_client: unknown client_id "${esc(p.client_id ?? '')}"</p>`
			);
		}
		let redirectUrl: URL;
		try {
			redirectUrl = new URL(p.redirect_uri ?? '');
			if (redirectUrl.hash) throw new Error('fragment');
		} catch {
			return html(
				res,
				400,
				'Authorization error',
				'<p class="error">invalid_request: redirect_uri is missing or not an absolute URI without fragment</p>'
			);
		}

		const types = new Set((p.response_type ?? '').split(/\s+/).filter(Boolean));
		const hasCode = types.has('code');
		const hasToken = types.has('token');
		const hasIdToken = types.has('id_token');
		const frontChannel = hasToken || hasIdToken;
		const requestedMode = p.response_mode || '';
		const errorMode =
			requestedMode === 'fragment' || (!requestedMode && frontChannel) ? 'fragment' : 'query';

		const deliver = (mode: string, params: Record<string, string>): string => {
			const target = new URL(redirectUrl.href);
			const usp = new URLSearchParams(mode === 'fragment' ? '' : target.search);
			for (const [k, v] of Object.entries(params)) usp.set(k, v);
			if (mode === 'fragment') target.hash = usp.toString();
			else target.search = usp.toString();
			return target.href;
		};
		const fail = (error: string, description: string, mode = errorMode): void => {
			const out: Record<string, string> = { error, error_description: description };
			if (p.state) out.state = p.state;
			out.iss = origin;
			redirect(res, deliver(mode, out));
		};

		if (p.mock_error) {
			return fail(p.mock_error, p.mock_error_description || `Forced by mock_error=${p.mock_error}`);
		}
		if (types.size === 0 || [...types].some((t) => !['code', 'token', 'id_token'].includes(t))) {
			return fail(
				'unsupported_response_type',
				`Unsupported response_type "${p.response_type ?? ''}"`
			);
		}
		if (requestedMode && requestedMode !== 'query' && requestedMode !== 'fragment') {
			return fail('unsupported_response_mode', `Unsupported response_mode "${requestedMode}"`);
		}
		const mode = requestedMode || (frontChannel ? 'fragment' : 'query');
		if (frontChannel && mode === 'query') {
			return fail(
				'invalid_request',
				'response_mode=query is not allowed when response_type contains token or id_token',
				'fragment'
			);
		}
		const scope = scopeList(p.scope ?? '').join(' ');
		if (hasIdToken && !scopeList(scope).includes('openid')) {
			return fail(
				'invalid_scope',
				'scope must contain openid when response_type contains id_token',
				mode
			);
		}
		if (hasIdToken && !p.nonce) {
			return fail(
				'invalid_request',
				'nonce is required when response_type contains id_token',
				mode
			);
		}
		if (p.code_challenge_method && !p.code_challenge) {
			return fail('invalid_request', 'code_challenge_method requires code_challenge', mode);
		}
		const challengeMethod = p.code_challenge_method || 'plain';
		if (p.code_challenge && challengeMethod !== 'S256' && challengeMethod !== 'plain') {
			return fail(
				'invalid_request',
				`Unsupported code_challenge_method "${challengeMethod}"`,
				mode
			);
		}
		const alg = p.mock_alg || 'RS256';
		if (!ID_TOKEN_ALGS.has(alg))
			return fail('invalid_request', `Unsupported mock_alg "${alg}"`, mode);
		if (alg === 'HS256' && client.secret === null) {
			return fail('invalid_request', 'mock_alg=HS256 needs a confidential client', mode);
		}

		// --- authentication / consent
		const prompts = (p.prompt ?? '').split(/\s+/).filter(Boolean);
		const cookieSid = parseCookies(header(req, 'cookie')).mock_sso;
		const existing = cookieSid ? sessions.get(cookieSid) : undefined;
		const maxAge = p.max_age ? Number(p.max_age) : null;
		const stale =
			existing &&
			maxAge !== null &&
			Number.isFinite(maxAge) &&
			Date.now() - existing.authTime > maxAge * 1000;
		let session: Session;
		const extraHeaders: Record<string, string> = {};

		if (p.mock_auto_approve === '1') {
			session = { sid: randomUUID(), sub: MOCK_USER.sub, authTime: Date.now() };
		} else if (isPost) {
			if (p.action === 'cancel') return fail('access_denied', 'The user denied the request', mode);
			if (p.username !== MOCK_USER.username || !safeEqual(p.password ?? '', MOCK_USER.password)) {
				return html(res, 401, 'Sign in', loginForm(p, 'Invalid username or password'));
			}
			session = { sid: randomUUID(), sub: MOCK_USER.sub, authTime: Date.now() };
			sessions.set(session.sid, session);
			extraHeaders['set-cookie'] = `mock_sso=${session.sid}; Path=/; HttpOnly; SameSite=Lax`;
		} else if (existing && !prompts.includes('login') && !stale) {
			session = existing;
		} else if (prompts.includes('none')) {
			return fail('login_required', 'prompt=none but there is no active session', mode);
		} else {
			return html(res, 200, 'Sign in', loginForm(p, null));
		}

		// --- issue
		const expired = p.mock_expired === '1';
		const nonce = p.nonce || null;
		const out: Record<string, string> = {};
		let code: string | undefined;
		if (hasCode) {
			code = randomToken(24);
			codes.set(code, {
				clientId: client.id,
				redirectUri: p.redirect_uri,
				scope,
				sub: session.sub,
				nonce,
				authTime: session.authTime,
				sid: session.sid,
				challenge: p.code_challenge || null,
				challengeMethod,
				alg,
				expiresAt: Date.now() + CODE_TTL_MS
			});
			out.code = code;
		}
		let accessToken: string | undefined;
		if (hasToken) {
			accessToken = await mintAccessToken({
				sub: session.sub,
				clientId: client.id,
				scope,
				audience: p.audience || p.resource
			});
			out.access_token = accessToken;
			out.token_type = 'Bearer';
			out.expires_in = String(ACCESS_TOKEN_TTL);
			if (scope) out.scope = scope;
		}
		if (hasIdToken) {
			out.id_token = await mintIdToken({
				client,
				sub: session.sub,
				scope,
				nonce,
				authTime: session.authTime,
				sid: session.sid,
				alg,
				expired,
				accessToken,
				code
			});
		}
		if (p.state) out.state = p.state;
		out.iss = origin;
		redirect(res, deliver(mode, out), extraHeaders);
	}

	// ---------------------------------------------------------------- /token

	async function tokenResponse(
		res: ServerResponse,
		o: {
			client: MockClient;
			sub: string;
			scope: string;
			nonce: string | null;
			authTime: number;
			sid: string;
			alg: string;
			expired: boolean;
			withRefresh: boolean;
			withIdToken: boolean;
			audience?: string;
		}
	): Promise<void> {
		const accessToken = await mintAccessToken({
			sub: o.sub,
			clientId: o.client.id,
			scope: o.scope,
			audience: o.audience
		});
		const body: Record<string, unknown> = {
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: ACCESS_TOKEN_TTL
		};
		if (o.withRefresh) {
			body.refresh_token = newRefreshToken({
				clientId: o.client.id,
				scope: o.scope,
				sub: o.sub,
				authTime: o.authTime,
				sid: o.sid,
				alg: o.alg
			});
		}
		if (o.withIdToken && scopeList(o.scope).includes('openid')) {
			body.id_token = await mintIdToken({
				client: o.client,
				sub: o.sub,
				scope: o.scope,
				nonce: o.nonce,
				authTime: o.authTime,
				sid: o.sid,
				alg: o.alg,
				expired: o.expired,
				accessToken
			});
		}
		if (o.scope) body.scope = o.scope;
		json(res, 200, body, { pragma: 'no-cache' });
	}

	async function token(
		req: IncomingMessage,
		res: ServerResponse,
		form: Form | null
	): Promise<void> {
		if (req.method !== 'POST') {
			return oauthError(res, 405, 'invalid_request', 'The token endpoint only accepts POST', {
				allow: 'POST, OPTIONS'
			});
		}
		if (header(req, 'x-mock-nonjson')) {
			return send(
				res,
				502,
				'text/html; charset=utf-8',
				'<html><body><h1>502 Bad Gateway</h1></body></html>'
			);
		}
		if (!form) {
			return oauthError(
				res,
				400,
				'invalid_request',
				'Content-Type must be application/x-www-form-urlencoded'
			);
		}
		const auth = await authenticateClient(req, form);
		if (!auth.ok) {
			return oauthError(
				res,
				auth.status,
				auth.error,
				auth.description,
				auth.basic ? { 'www-authenticate': 'Basic realm="mock-idp"' } : {}
			);
		}
		const client = auth.client;
		const algHeader = header(req, 'x-mock-idtoken-alg');
		const expiredKnob = !!header(req, 'x-mock-expired-idtoken');
		const algOverride = algHeader && ID_TOKEN_ALGS.has(algHeader) ? algHeader : null;
		const grant = form.grant_type ?? '';

		switch (grant) {
			case 'authorization_code': {
				const rec = codes.get(form.code ?? '');
				if (!rec)
					return oauthError(
						res,
						400,
						'invalid_grant',
						'Unknown, expired or already used authorization code'
					);
				codes.delete(form.code);
				if (rec.clientId !== client.id)
					return oauthError(
						res,
						400,
						'invalid_grant',
						'Authorization code was issued to another client'
					);
				if (Date.now() > rec.expiresAt)
					return oauthError(res, 400, 'invalid_grant', 'Authorization code expired');
				if (form.redirect_uri !== rec.redirectUri) {
					return oauthError(
						res,
						400,
						'invalid_grant',
						`redirect_uri mismatch: expected "${rec.redirectUri}"`
					);
				}
				if (rec.challenge) {
					const verifier = form.code_verifier;
					if (!verifier) return oauthError(res, 400, 'invalid_grant', 'code_verifier is required');
					if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) {
						return oauthError(
							res,
							400,
							'invalid_grant',
							'code_verifier must be 43-128 unreserved characters'
						);
					}
					const computed = rec.challengeMethod === 'S256' ? sha256b64url(verifier) : verifier;
					if (!safeEqual(computed, rec.challenge)) {
						return oauthError(res, 400, 'invalid_grant', 'PKCE verification failed');
					}
				}
				return tokenResponse(res, {
					client,
					sub: rec.sub,
					scope: rec.scope,
					nonce: rec.nonce,
					authTime: rec.authTime,
					sid: rec.sid,
					alg: algOverride ?? rec.alg,
					expired: expiredKnob,
					withRefresh: true,
					withIdToken: true
				});
			}
			case 'client_credentials': {
				if (client.secret === null) {
					return oauthError(
						res,
						400,
						'unauthorized_client',
						'Public clients cannot use client_credentials'
					);
				}
				return tokenResponse(res, {
					client,
					sub: client.id,
					scope: scopeList(form.scope ?? '').join(' '),
					nonce: null,
					authTime: Date.now(),
					sid: randomUUID(),
					alg: 'RS256',
					expired: false,
					withRefresh: false,
					withIdToken: false,
					audience: form.audience || form.resource
				});
			}
			case 'password': {
				if (
					form.username !== MOCK_USER.username ||
					!safeEqual(form.password ?? '', MOCK_USER.password)
				) {
					return oauthError(res, 400, 'invalid_grant', 'Invalid resource owner credentials');
				}
				return tokenResponse(res, {
					client,
					sub: MOCK_USER.sub,
					scope: scopeList(form.scope ?? '').join(' '),
					nonce: null,
					authTime: Date.now(),
					sid: randomUUID(),
					alg: algOverride ?? 'RS256',
					expired: expiredKnob,
					withRefresh: true,
					withIdToken: true
				});
			}
			case 'refresh_token': {
				const rec = refreshTokens.get(form.refresh_token ?? '');
				if (!rec || rec.clientId !== client.id) {
					return oauthError(res, 400, 'invalid_grant', 'Unknown, rotated or foreign refresh token');
				}
				let scope = rec.scope;
				if (form.scope) {
					const asked = scopeList(form.scope);
					const allowed = scopeList(rec.scope);
					if (asked.some((s) => !allowed.includes(s))) {
						return oauthError(
							res,
							400,
							'invalid_scope',
							'Requested scope exceeds the original grant'
						);
					}
					scope = asked.join(' ');
				}
				refreshTokens.delete(form.refresh_token); // rotation
				return tokenResponse(res, {
					client,
					sub: rec.sub,
					scope,
					nonce: null,
					authTime: rec.authTime,
					sid: rec.sid,
					alg: algOverride ?? rec.alg,
					expired: expiredKnob,
					withRefresh: true,
					withIdToken: true
				});
			}
			case DEVICE_GRANT: {
				const rec = devices.get(form.device_code ?? '');
				if (!rec || rec.clientId !== client.id) {
					return oauthError(res, 400, 'invalid_grant', 'Unknown device_code');
				}
				const now = Date.now();
				if (now > rec.expiresAt) {
					devices.delete(rec.deviceCode);
					return oauthError(res, 400, 'expired_token', 'The device code has expired');
				}
				const tooFast = now - rec.lastPoll < rec.interval * 1000 - 50;
				rec.lastPoll = now;
				if (tooFast) {
					rec.interval += 5;
					return oauthError(
						res,
						400,
						'slow_down',
						`Polling too fast; interval is now ${rec.interval}s`
					);
				}
				if (rec.status === 'pending') {
					return oauthError(
						res,
						400,
						'authorization_pending',
						'The user has not approved the request yet'
					);
				}
				devices.delete(rec.deviceCode);
				if (rec.status === 'denied')
					return oauthError(res, 400, 'access_denied', 'The user denied the request');
				return tokenResponse(res, {
					client,
					sub: MOCK_USER.sub,
					scope: rec.scope,
					nonce: null,
					authTime: now,
					sid: randomUUID(),
					alg: algOverride ?? rec.alg,
					expired: expiredKnob,
					withRefresh: true,
					withIdToken: true
				});
			}
			default:
				return oauthError(res, 400, 'unsupported_grant_type', `Unsupported grant_type "${grant}"`);
		}
	}

	// ---------------------------------------------------------------- /userinfo

	async function userinfo(req: IncomingMessage, res: ServerResponse): Promise<void> {
		if (req.method !== 'GET' && req.method !== 'POST') {
			return oauthError(res, 405, 'invalid_request', 'GET or POST only', {
				allow: 'GET, POST, OPTIONS'
			});
		}
		const authz = header(req, 'authorization') ?? '';
		const m = /^Bearer\s+(\S+)$/i.exec(authz);
		const bearer = (error: string, description: string, status: number) =>
			json(
				res,
				status,
				{ error, error_description: description },
				{
					'www-authenticate': `Bearer error="${error}", error_description="${description}"`
				}
			);
		if (!m) return bearer('invalid_token', 'Missing Bearer access token', 401);
		try {
			const { payload } = await jwtVerify(m[1], rsa.publicKey, {
				issuer: origin,
				algorithms: ['RS256']
			});
			const scopes = scopeList(String(payload.scope ?? ''));
			if (!scopes.includes('openid') || payload.sub === payload.client_id) {
				return bearer('insufficient_scope', 'The access token has no openid scope or user', 403);
			}
			const out: Record<string, unknown> = { sub: payload.sub };
			if (scopes.includes('profile')) {
				out.name = MOCK_USER.name;
				out.preferred_username = MOCK_USER.username;
				out.given_name = MOCK_USER.givenName;
				out.family_name = MOCK_USER.familyName;
			}
			if (scopes.includes('email')) {
				out.email = MOCK_USER.email;
				out.email_verified = true;
			}
			json(res, 200, out);
		} catch (err) {
			bearer('invalid_token', (err as Error).message.replaceAll('"', "'"), 401);
		}
	}

	// ---------------------------------------------------------------- device flow

	function normalizeUserCode(code: string): string {
		return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
	}

	function findDevice(userCode: string): DeviceRecord | undefined {
		const wanted = normalizeUserCode(userCode);
		if (!wanted) return undefined;
		for (const d of devices.values()) {
			if (normalizeUserCode(d.userCode) === wanted && Date.now() <= d.expiresAt) return d;
		}
		return undefined;
	}

	async function deviceAuthorization(
		req: IncomingMessage,
		res: ServerResponse,
		form: Form | null
	): Promise<void> {
		if (req.method !== 'POST') {
			return oauthError(res, 405, 'invalid_request', 'POST only', { allow: 'POST, OPTIONS' });
		}
		if (!form) {
			return oauthError(
				res,
				400,
				'invalid_request',
				'Content-Type must be application/x-www-form-urlencoded'
			);
		}
		const auth = await authenticateClient(req, form);
		if (!auth.ok) {
			return oauthError(
				res,
				auth.status,
				auth.error,
				auth.description,
				auth.basic ? { 'www-authenticate': 'Basic realm="mock-idp"' } : {}
			);
		}
		const alg = form.mock_alg || 'RS256';
		if (!ID_TOKEN_ALGS.has(alg) || (alg === 'HS256' && auth.client.secret === null)) {
			return oauthError(res, 400, 'invalid_request', `Unusable mock_alg "${alg}"`);
		}
		const pick = () =>
			Array.from(randomBytes(8), (b) => USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]).join('');
		const raw = pick();
		const userCode = `${raw.slice(0, 4)}-${raw.slice(4)}`;
		const interval = Number(form.mock_interval) > 0 ? Number(form.mock_interval) : 5;
		const expiresIn = Number(form.mock_expires_in) > 0 ? Number(form.mock_expires_in) : 600;
		const rec: DeviceRecord = {
			deviceCode: `dc_${randomToken(24)}`,
			userCode,
			clientId: auth.client.id,
			scope: scopeList(form.scope ?? '').join(' '),
			alg,
			status: 'pending',
			interval,
			lastPoll: Date.now(),
			expiresAt: Date.now() + expiresIn * 1000
		};
		devices.set(rec.deviceCode, rec);
		const body: Record<string, unknown> = {
			device_code: rec.deviceCode,
			user_code: userCode,
			verification_uri: `${origin}/device`,
			expires_in: expiresIn,
			interval
		};
		if (form.mock_no_complete !== '1') {
			const complete = new URLSearchParams({ user_code: userCode });
			if (form.mock_auto_approve === '1') complete.set('mock_auto_approve', '1');
			body.verification_uri_complete = `${origin}/device?${complete.toString()}`;
		}
		json(res, 200, body);
	}

	function devicePage(
		res: ServerResponse,
		userCode: string,
		error: string | null,
		status = 200
	): void {
		html(
			res,
			status,
			'Device verification',
			(error ? `<p class="error" id="device-error">${esc(error)}</p>` : '') +
				'<form method="post" action="/device" id="device-form">' +
				'<label for="user_code">Code</label>' +
				`<input id="user_code" name="user_code" value="${esc(userCode)}" autocomplete="off">` +
				'<button type="submit" name="action" value="approve">Approve</button>' +
				'<button type="submit" name="action" value="deny">Deny</button></form>'
		);
	}

	function device(req: IncomingMessage, res: ServerResponse, url: URL, form: Form | null): void {
		if (req.method === 'POST') {
			const f = form ?? {};
			const rec = findDevice(f.user_code ?? '');
			if (!rec) return devicePage(res, f.user_code ?? '', 'Unknown or expired code', 400);
			rec.status = f.action === 'deny' ? 'denied' : 'approved';
			return html(
				res,
				200,
				rec.status === 'approved' ? 'Device approved' : 'Device denied',
				'<p id="device-result">You can close this window.</p>'
			);
		}
		const q = firstValues(url.searchParams);
		if (!q.user_code) return devicePage(res, '', null);
		const rec = findDevice(q.user_code);
		if (!rec) return devicePage(res, q.user_code, 'Unknown or expired code', 400);
		if (q.mock_auto_approve === '1') {
			rec.status = 'approved';
			return html(
				res,
				200,
				'Device approved',
				'<p id="device-result">You can close this window.</p>'
			);
		}
		devicePage(res, q.user_code, null);
	}

	// ---------------------------------------------------------------- discovery & misc

	function discoveryDocument(): Record<string, unknown> {
		return {
			issuer: origin,
			authorization_endpoint: `${origin}/authorize`,
			token_endpoint: `${origin}/token`,
			userinfo_endpoint: `${origin}/userinfo`,
			jwks_uri: `${origin}/jwks`,
			device_authorization_endpoint: `${origin}/device_authorization`,
			end_session_endpoint: `${origin}/logout`,
			grant_types_supported: [
				'authorization_code',
				'implicit',
				'client_credentials',
				'password',
				'refresh_token',
				DEVICE_GRANT
			],
			response_types_supported: [
				'code',
				'token',
				'id_token',
				'id_token token',
				'code id_token',
				'code token',
				'code id_token token'
			],
			response_modes_supported: ['query', 'fragment'],
			scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
			token_endpoint_auth_methods_supported: [
				'none',
				'client_secret_basic',
				'client_secret_post',
				'client_secret_jwt'
			],
			token_endpoint_auth_signing_alg_values_supported: ['HS256', 'HS384', 'HS512'],
			code_challenge_methods_supported: ['S256', 'plain'],
			id_token_signing_alg_values_supported: ['RS256', 'ES256', 'HS256', 'none'],
			subject_types_supported: ['public'],
			claims_supported: [
				'sub',
				'iss',
				'aud',
				'exp',
				'iat',
				'auth_time',
				'nonce',
				'sid',
				'at_hash',
				'c_hash',
				'name',
				'preferred_username',
				'given_name',
				'family_name',
				'email',
				'email_verified'
			],
			authorization_response_iss_parameter_supported: true
		};
	}

	function logout(req: IncomingMessage, res: ServerResponse, url: URL): void {
		const sid = parseCookies(header(req, 'cookie')).mock_sso;
		if (sid) sessions.delete(sid);
		const clear = { 'set-cookie': 'mock_sso=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax' };
		const target = url.searchParams.get('post_logout_redirect_uri');
		if (target) {
			try {
				const t = new URL(target);
				const state = url.searchParams.get('state');
				if (state) t.searchParams.set('state', state);
				return redirect(res, t.href, clear);
			} catch {
				// fall through to the plain page
			}
		}
		html(res, 200, 'Signed out', '<p id="logout-result">You have been signed out.</p>', clear);
	}

	// ---------------------------------------------------------------- dispatcher

	async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? '/', origin);
		const body = await readBody(req);
		const contentType = (header(req, 'content-type') ?? '').toLowerCase();
		const form = contentType.startsWith('application/x-www-form-urlencoded')
			? firstValues(new URLSearchParams(body))
			: null;
		const headers: Record<string, string> = {};
		for (const [k, v] of Object.entries(req.headers))
			headers[k] = Array.isArray(v) ? v.join(', ') : (v ?? '');
		const entry: LoggedRequest = {
			method: req.method ?? 'GET',
			path: url.pathname,
			url: url.pathname + url.search,
			headers,
			body,
			form,
			status: null,
			at: new Date().toISOString()
		};
		requests.push(entry);
		res.on('finish', () => {
			entry.status = res.statusCode;
		});

		const delay = Number(header(req, 'x-mock-delay-ms'));
		if (delay > 0) await sleep(delay);

		const path = url.pathname;
		const corsPath = CORS_PATHS.has(path);
		if (corsPath) {
			if (req.method === 'OPTIONS') {
				applyCors(req, res, true);
				res.writeHead(204, { 'content-length': '0' });
				res.end();
				return;
			}
			applyCors(req, res, false);
		}

		const forcedError = header(req, 'x-mock-error');
		if (
			forcedError &&
			(path === '/token' || path === '/device_authorization' || path === '/userinfo')
		) {
			const status = Number(header(req, 'x-mock-error-status')) || 400;
			return json(
				res,
				status,
				{
					error: forcedError,
					error_description: `Forced by X-Mock-Error: ${forcedError}`,
					error_uri: `https://mock-idp.invalid/errors/${encodeURIComponent(forcedError)}`
				},
				{ pragma: 'no-cache' }
			);
		}

		const redirectMatch = /^\/mock\/redirect\/(\d+)$/.exec(path);
		switch (true) {
			case path === '/.well-known/openid-configuration':
				if (oauthOnly) return json(res, 404, { error: 'not_found' });
				return json(res, 200, discoveryDocument(), { 'cache-control': 'no-cache' });
			case path === '/.well-known/oauth-authorization-server':
				return json(res, 200, discoveryDocument(), { 'cache-control': 'no-cache' });
			case path === '/jwks':
				return json(res, 200, jwks, { 'cache-control': 'no-cache' });
			case path === '/authorize':
				if (req.method !== 'GET' && req.method !== 'POST') {
					return html(res, 405, 'Method not allowed', '<p>Use GET or POST.</p>', {
						allow: 'GET, POST'
					});
				}
				return authorize(req, res, url, form);
			case path === '/token':
				return token(req, res, form);
			case path === '/userinfo':
				return userinfo(req, res);
			case path === '/device_authorization':
				return deviceAuthorization(req, res, form);
			case path === '/device':
				return device(req, res, url, form);
			case path === '/logout':
				return logout(req, res, url);
			case redirectMatch !== null: {
				const n = Number(redirectMatch?.[1]);
				return redirect(
					res,
					n > 0 ? `${origin}/mock/redirect/${n - 1}` : `${origin}/.well-known/openid-configuration`
				);
			}
			default:
				return json(res, 404, { error: 'not_found', error_description: `No route for ${path}` });
		}
	}

	const listener = (req: IncomingMessage, res: ServerResponse): void => {
		handle(req, res).catch((err: unknown) => {
			if (res.headersSent) {
				res.destroy();
				return;
			}
			json(res, 500, { error: 'server_error', error_description: (err as Error).message });
		});
	};

	let server: HttpServer;
	if (tls) {
		const cert = await generateCert([{ name: 'commonName', value: 'localhost' }], {
			keySize: 2048,
			algorithm: 'sha256',
			extensions: [
				{
					name: 'subjectAltName',
					altNames: [
						{ type: 2, value: 'localhost' },
						{ type: 7, ip: '127.0.0.1' },
						{ type: 7, ip: '::1' }
					]
				}
			]
		});
		server = createHttpsServer(
			{ key: cert.private, cert: cert.cert },
			listener
		) as unknown as HttpServer;
	} else {
		server = createHttpServer(listener);
	}

	const listening = Promise.withResolvers<void>();
	server.once('error', listening.reject);
	server.listen(options.port ?? 0, '127.0.0.1', () => listening.resolve());
	await listening.promise;
	const port = (server.address() as AddressInfo).port;
	origin = `${tls ? 'https' : 'http'}://localhost:${port}`;

	return {
		url: origin,
		port,
		requests,
		jwks,
		clearRequests() {
			requests.length = 0;
		},
		stop() {
			const { promise, resolve } = Promise.withResolvers<void>();
			server.close(() => resolve());
			server.closeAllConnections();
			return promise;
		}
	};
}

// ---------------------------------------------------------------- CLI

const isMain =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	const { values } = parseArgs({
		options: {
			cors: { type: 'string', default: process.env.MOCK_IDP_CORS ?? 'none' },
			'http-port': { type: 'string', default: '4455' },
			'https-port': { type: 'string', default: '4456' }
		}
	});
	const corsMode = values.cors as CorsMode;
	if (!['none', 'star', 'origin'].includes(corsMode)) {
		console.error(`Invalid --cors "${corsMode}" (none|star|origin)`);
		process.exit(1);
	}
	const plain = await startMockIdp({
		port: Number(values['http-port']),
		tls: false,
		cors: corsMode
	});
	const secure = await startMockIdp({
		port: Number(values['https-port']),
		tls: true,
		cors: corsMode
	});
	console.log(`mock-idp http  ${plain.url}`);
	console.log(`mock-idp https ${secure.url} (self-signed)`);
	console.log(
		`user alice / alice-pw; clients public-spa, conf-basic, conf-post, conf-jwt; cors=${corsMode}`
	);
	const shutdown = () => {
		void Promise.all([plain.stop(), secure.stop()]).then(() => process.exit(0));
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}
