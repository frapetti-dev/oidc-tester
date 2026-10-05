import type { JSONWebKeySet } from 'jose';
import type { HttpExchange, HttpFailure, IpcApi, NavigationRecord } from '#lib/ipc/types.js';
import { validateIdToken, type IdTokenContext } from '#lib/jwt/idToken.js';
import { inspectToken } from '#lib/jwt/decode.js';
import { verifySignature, type SignatureResult, type SignatureStatus } from '#lib/jwt/verify.js';
import type { CallbackResult, Run, RunError, Tokens, Validation } from '#lib/model/run.js';
import type { Flow, Idp } from '#lib/model/schema.js';
import {
	buildAuthorizeUrl,
	effectiveResponseType,
	generateAuthorizeValues,
	type AuthorizeValues
} from '#lib/oauth/authorize.js';
import { parseCallback } from '#lib/oauth/callback.js';
import { runDeviceFlow, type DeviceUserCode } from '#lib/oauth/device.js';
import { requestTokens, type Grant } from '#lib/oauth/tokenRequest.js';
import { parseJsonResponse } from '#lib/oauth/tokenResponse.js';
import {
	buildRequestSpec,
	newHttpLog,
	sendWithRedirects,
	type HttpLog
} from '#lib/oauth/transport.js';
import { clientSecretKey, errorMessage, passwordKey } from '#lib/state/secrets.js';

export interface RunContext {
	ipc: IpcApi;
	workspaceId: string;
	idp: Idp;
	flow: Flow;
	/** Aborting closes the auth window, stops device polling and ends the run as `cancelled`. */
	signal: AbortSignal;
	/** Epoch milliseconds clock (default `Date.now`). */
	now?: () => number;
	/** Delay used between device polls (default `setTimeout`). */
	sleep?: (ms: number) => Promise<void>;
	/** Device flow: the user code to show; `null` once polling has stopped. */
	onDeviceCode?: (info: DeviceUserCode | null) => void;
	/**
	 * Called after each stage with a snapshot of the run so far. Snapshots are provisional:
	 * `status` is `error` when an error is already known, else `success`, and `finishedAt` is "now".
	 */
	onProgress?: (run: Run) => void;
	appVersion?: string;
}

export interface UserInfoResult {
	/** The last response (after redirects), when one was received. */
	exchange?: HttpExchange;
	failure?: HttpFailure;
	/** Parsed JSON, or the raw text for non-JSON 2xx responses (e.g. signed userinfo JWTs). */
	body?: unknown;
	error?: RunError;
}

/** Everything a stage needs; `state` is the mutable result of the run. */
interface Env {
	ctx: RunContext;
	ipc: IpcApi;
	/** Private clones: later edits to the live objects do not affect a running run. */
	idp: Idp;
	flow: Flow;
	now: () => number;
	log: HttpLog;
	state: RunState;
	secret: string | null;
	/** Resolves with 'aborted' when the signal fires. */
	aborted: Promise<'aborted'>;
	progress: () => void;
}

interface RunState {
	authorizeUrl?: string;
	navigations: NavigationRecord[];
	callback?: CallbackResult;
	tokens?: Tokens;
	error?: RunError;
	validations: Validation[];
	cancelled: boolean;
	/** Random inputs of the authorize request (front-channel flows). */
	values?: AuthorizeValues;
}

const SIGNATURE_LEVEL: Record<SignatureStatus, Validation['level']> = {
	valid: 'ok',
	invalid: 'error',
	unsigned: 'error',
	no_key: 'warn',
	jwks_unavailable: 'warn'
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function defaultSleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

const responseTypeTokens = (flow: Flow) =>
	new Set(effectiveResponseType(flow).split(/\s+/).filter(Boolean));

/**
 * Runs one flow end to end and returns the complete record. Never throws: unexpected exceptions
 * become a `user` error. Status is `cancelled` when the popup was closed or the signal aborted.
 */
export async function executeRun(ctx: RunContext): Promise<Run> {
	const now = ctx.now ?? Date.now;
	const idp = clone(ctx.idp);
	const flow = clone(ctx.flow);
	const startedAt = new Date(now()).toISOString();
	const log = newHttpLog();
	const state: RunState = { navigations: [], validations: [], cancelled: false };
	const id = crypto.randomUUID();

	const snapshot = (): Run => {
		const run: Run = {
			id,
			workspaceId: ctx.workspaceId,
			idpId: idp.id,
			flowId: flow.id,
			flowSnapshot: clone(flow),
			idpSnapshot: clone(idp),
			startedAt,
			finishedAt: new Date(now()).toISOString(),
			status: state.cancelled ? 'cancelled' : state.error ? 'error' : 'success',
			navigations: [...state.navigations],
			exchanges: [...log.exchanges],
			failures: [...log.failures],
			validations: [...state.validations]
		};
		if (state.authorizeUrl !== undefined) run.authorizeUrl = state.authorizeUrl;
		if (state.callback) run.callback = state.callback;
		if (state.tokens) run.tokens = state.tokens;
		if (state.error && !state.cancelled) run.error = state.error;
		return run;
	};

	const { promise: aborted, resolve } = Promise.withResolvers<'aborted'>();
	const onAbort = () => resolve('aborted');
	if (ctx.signal.aborted) onAbort();
	else ctx.signal.addEventListener('abort', onAbort, { once: true });

	const env: Env = {
		ctx,
		ipc: ctx.ipc,
		idp,
		flow,
		now,
		log,
		state,
		secret: null,
		aborted,
		progress: () => ctx.onProgress?.(snapshot())
	};

	try {
		env.secret = await ctx.ipc.secretGet(clientSecretKey(idp.id));
		if (flow.type === 'device_code') await deviceStage(env);
		else if (isAuthorizationEndpointFlow(flow)) await frontChannelStage(env);
		else await backChannelStage(env);
		if (ctx.signal.aborted) state.cancelled = true;
		if (state.tokens && !state.cancelled) {
			await inspectTokens(env);
			env.progress();
		}
	} catch (e) {
		state.error = { source: 'user', error: 'unexpected_error', detail: errorMessage(e) };
	} finally {
		ctx.signal.removeEventListener('abort', onAbort);
	}
	return snapshot();
}

const isAuthorizationEndpointFlow = (flow: Flow) =>
	flow.type === 'authorization_code' ||
	flow.type === 'authorization_code_pkce' ||
	flow.type === 'implicit' ||
	flow.type === 'hybrid';

function frontChannelTokens(callback: CallbackResult): Tokens | undefined {
	if (callback.access_token === undefined && callback.id_token === undefined) return undefined;
	const tokens: Tokens = { raw: {} };
	for (const key of ['access_token', 'id_token', 'token_type', 'scope'] as const) {
		const value = callback[key];
		if (value === undefined) continue;
		tokens[key] = value;
		tokens.raw[key] = value;
	}
	const expiresIn = Number(callback.expires_in);
	if (
		callback.expires_in !== undefined &&
		callback.expires_in !== '' &&
		Number.isFinite(expiresIn)
	) {
		tokens.expires_in = expiresIn;
		tokens.raw.expires_in = expiresIn;
	}
	return tokens;
}

/**
 * Hybrid merge: values from the token endpoint win; anything the token response lacks (typically
 * the front-channel `id_token`) is kept from the authorization response.
 */
function mergeTokens(front: Tokens | undefined, back: Tokens): Tokens {
	if (!front) return back;
	return { ...front, ...back, raw: { ...front.raw, ...back.raw } };
}

async function frontChannelStage(env: Env): Promise<void> {
	const { ipc, idp, flow, state } = env;
	const redirectUri = flow.params.redirectUri.trim();
	if (redirectUri === '') {
		state.error = {
			source: 'validation',
			error: 'missing_redirect_uri',
			error_description: 'The redirect URI is empty, the popup cannot capture the response'
		};
		return;
	}

	const values = generateAuthorizeValues(flow);
	state.values = values;
	const built = await buildAuthorizeUrl(idp, flow, values);
	if (!built.ok) {
		state.error = built.error;
		return;
	}
	state.authorizeUrl = built.url;
	env.progress();

	const opening = ipc.authWindowOpen({
		url: built.url,
		redirectUri,
		cleanSession: flow.cleanSession,
		title: `${idp.name}: ${flow.name}`
	});
	opening.catch(() => undefined); // losing the race below must not leave an unhandled rejection
	let result: Awaited<typeof opening> | 'aborted';
	try {
		result = await Promise.race([opening, env.aborted]);
	} catch (e) {
		state.error = { source: 'user', error: 'auth_window_failed', detail: errorMessage(e) };
		return;
	}
	if (result === 'aborted') {
		await ipc.authWindowClose().catch(() => undefined);
		state.cancelled = true;
		return;
	}
	state.navigations = result.navigations;
	if (result.kind === 'closed') {
		state.cancelled = true;
		return;
	}

	const parsed = parseCallback(result.url, {
		state: values.state === '' ? null : values.state,
		issuer: idp.issuer
	});
	state.callback = parsed.callback;
	env.progress();
	if (parsed.error) {
		state.error = parsed.error;
		return;
	}

	const front = frontChannelTokens(parsed.callback);
	if (flow.type === 'implicit') {
		if (!front) {
			state.error = {
				source: 'validation',
				error: 'missing_tokens',
				error_description: 'The callback contains neither access_token nor id_token'
			};
			return;
		}
		state.tokens = front;
		return;
	}

	if (front) state.tokens = front;
	const code = parsed.callback.code;
	if (code === undefined || code === '') {
		state.error = {
			source: 'validation',
			error: 'missing_code',
			error_description: 'The callback contains no authorization code'
		};
		return;
	}
	await tokenStage(env, {
		type: 'authorization_code',
		code,
		redirectUri,
		codeVerifier: values.codeVerifier
	});
}

async function backChannelStage(env: Env): Promise<void> {
	const { ipc, flow } = env;
	let grant: Grant;
	if (flow.type === 'password') {
		const password = await ipc.secretGet(passwordKey(flow.id));
		grant = { type: 'password', username: flow.params.username, password: password ?? '' };
	} else if (flow.type === 'refresh_token') {
		grant = { type: 'refresh_token', refreshToken: flow.params.refreshToken };
	} else {
		grant = { type: 'client_credentials' };
	}
	await tokenStage(env, grant);
}

/** One token endpoint request; its tokens are merged over any front-channel tokens. */
async function tokenStage(env: Env, grant: Grant): Promise<void> {
	const { ipc, idp, flow, state } = env;
	const result = await requestTokens(ipc, {
		idp,
		flow,
		grant,
		secret: env.secret,
		now: env.now,
		log: env.log
	});
	state.validations.push(...result.validations);
	if (result.error) state.error = result.error;
	else if (result.tokens) state.tokens = mergeTokens(state.tokens, result.tokens);
	env.progress();
}

async function deviceStage(env: Env): Promise<void> {
	const { ctx, ipc, idp, flow, state } = env;
	const sleep = ctx.sleep ?? defaultSleep;
	try {
		const result = await runDeviceFlow(ipc, {
			idp,
			flow,
			secret: env.secret,
			log: env.log,
			now: env.now,
			sleep: (ms) => Promise.race([sleep(ms), env.aborted]).then(() => undefined),
			onUserCode: (info) => {
				ctx.onDeviceCode?.(info);
				env.progress();
			},
			isCancelled: () => ctx.signal.aborted
		});
		state.validations.push(...result.validations);
		if (result.cancelled) state.cancelled = true;
		else if (result.error) state.error = result.error;
		else if (result.tokens) state.tokens = result.tokens;
	} finally {
		ctx.onDeviceCode?.(null);
	}
	env.progress();
}

type JwksOutcome =
	{ jwks: JSONWebKeySet; problem?: undefined } | { jwks?: undefined; problem: SignatureResult };

/** GET the IdP JWKS with the IdP's HTTP settings; every hop lands in the run's exchange log. */
async function fetchJwks(env: Env): Promise<JwksOutcome> {
	const { ipc, idp, flow, log } = env;
	const url = idp.endpoints.jwks.trim();
	if (url === '') {
		return {
			problem: {
				status: 'no_key',
				message: 'No JWKS endpoint is configured, the signature cannot be verified'
			}
		};
	}
	const unavailable = (reason: string): JwksOutcome => ({
		problem: { status: 'jwks_unavailable', message: `JWKS could not be retrieved: ${reason}` }
	});
	const spec = buildRequestSpec(idp, flow, {
		method: 'GET',
		url,
		protocolHeaders: [['Accept', 'application/json']]
	});
	const sent = await sendWithRedirects(ipc, spec, log);
	if (sent.failure) return unavailable(sent.failure.message);
	if (sent.error) return unavailable(sent.error);
	if (!sent.final) return unavailable('no response');
	const { status, body } = sent.final.response;
	if (status < 200 || status > 299) return unavailable(`HTTP ${status}`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return unavailable('the response is not JSON');
	}
	const keys = (parsed as { keys?: unknown } | null)?.keys;
	if (!Array.isArray(keys)) return unavailable('the response is not a JSON Web Key Set');
	return { jwks: parsed as JSONWebKeySet };
}

/** Signature rows (`sig.*`) and ID-token rows (`idt.*`) for the tokens of a finished run. */
async function inspectTokens(env: Env): Promise<void> {
	const { state } = env;
	const tokens = state.tokens;
	if (!tokens) return;

	let jwks: Promise<JwksOutcome> | undefined;
	const getJwks = () => (jwks ??= fetchJwks(env));

	const signatureRow = async (
		id: 'sig.id_token' | 'sig.access_token',
		token: string,
		header: Record<string, unknown>
	) => {
		const alg = typeof header.alg === 'string' ? header.alg : '';
		const kid = typeof header.kid === 'string' ? header.kid : undefined;
		const needsJwks = !alg.startsWith('HS') && alg.toLowerCase() !== 'none';
		const outcome = needsJwks ? await getJwks() : undefined;
		const result: SignatureResult = outcome?.problem
			? { ...outcome.problem, alg, kid }
			: await verifySignature(token, { jwks: outcome?.jwks ?? null, secret: env.secret });
		state.validations.push({ id, level: SIGNATURE_LEVEL[result.status], message: result.message });
	};

	if (tokens.id_token !== undefined) {
		const inspected = inspectToken(tokens.id_token);
		if (inspected.kind === 'jws') {
			await signatureRow('sig.id_token', tokens.id_token, inspected.header);
			await validateClaims(env, tokens.id_token, inspected.payload, inspected.header);
		} else {
			const message =
				inspected.kind === 'malformed'
					? `ID token is malformed: ${inspected.reason}`
					: inspected.kind === 'jwe'
						? 'ID token is encrypted (JWE), signature and claims cannot be checked'
						: 'ID token is not a JWT, signature and claims cannot be checked';
			state.validations.push({ id: 'sig.id_token', level: 'warn', message });
		}
	}

	if (tokens.access_token !== undefined) {
		const inspected = inspectToken(tokens.access_token);
		if (inspected.kind === 'jws') {
			await signatureRow('sig.access_token', tokens.access_token, inspected.header);
		}
	}
}

function claimsContext(env: Env, idToken: string): IdTokenContext {
	const { idp, flow, state } = env;
	const { callback, values } = state;
	const isHybrid = flow.type === 'hybrid';
	// at_hash / c_hash relate to the authorization endpoint response, so they only apply to the
	// ID token that came from there (implicit, or the hybrid front-channel token).
	const fromAuthorizationEndpoint =
		(flow.type === 'implicit' || isHybrid) && callback?.id_token === idToken;
	const types = responseTypeTokens(flow);
	const ctx: IdTokenContext = {
		issuer: idp.issuer,
		clientId: idp.client.clientId,
		nonce: isAuthorizationEndpointFlow(flow) ? (values?.nonce ?? null) : null,
		now: env.now(),
		requireAtHash: fromAuthorizationEndpoint && types.has('id_token') && types.has('token'),
		requireCHash:
			fromAuthorizationEndpoint && isHybrid && types.has('code') && types.has('id_token')
	};
	if (fromAuthorizationEndpoint) {
		if (callback?.access_token !== undefined) ctx.accessToken = callback.access_token;
		if (isHybrid && callback?.code !== undefined) ctx.code = callback.code;
	}
	return ctx;
}

/**
 * `idt.*` rows for the run's ID token. In a hybrid run whose token endpoint returned its own
 * ID token (which wins in `Run.tokens`), the front-channel ID token is not the one shown, but
 * c_hash/at_hash belong to it: those two rows are added from it, labelled "Front-channel".
 */
async function validateClaims(
	env: Env,
	idToken: string,
	payload: Record<string, unknown>,
	header: Record<string, unknown>
): Promise<void> {
	const { flow, state } = env;
	state.validations.push(...(await validateIdToken(payload, header, claimsContext(env, idToken))));

	const front = state.callback?.id_token;
	if (flow.type !== 'hybrid' || front === undefined || front === idToken) return;
	const inspected = inspectToken(front);
	if (inspected.kind !== 'jws') return;
	const rows = await validateIdToken(
		inspected.payload,
		inspected.header,
		claimsContext(env, front)
	);
	for (const row of rows) {
		if (row.id === 'idt.c_hash' || row.id === 'idt.at_hash') {
			state.validations.push({ ...row, message: `Front-channel ID token: ${row.message}` });
		}
	}
}

/**
 * GET the userinfo endpoint with `Authorization: Bearer <accessToken>` (a user-set Authorization
 * header on the IdP/flow wins). Never throws; the caller adds the exchange to the run.
 */
export async function callUserInfo(ctx: RunContext, accessToken: string): Promise<UserInfoResult> {
	const url = ctx.idp.endpoints.userinfo.trim();
	if (url === '') {
		return {
			error: {
				source: 'validation',
				error: 'missing_userinfo_endpoint',
				error_description: 'The userinfo endpoint is empty'
			}
		};
	}
	try {
		const spec = buildRequestSpec(ctx.idp, ctx.flow, {
			method: 'GET',
			url,
			protocolHeaders: [
				['Authorization', `Bearer ${accessToken}`],
				['Accept', 'application/json']
			]
		});
		const sent = await sendWithRedirects(ctx.ipc, spec, newHttpLog());
		const result: UserInfoResult = {};
		if (sent.final) result.exchange = sent.final;
		if (sent.failure) result.failure = sent.failure;

		const response = sent.final?.response;
		if (!sent.failure && response && response.status >= 200 && response.status <= 299) {
			try {
				result.body = JSON.parse(response.body);
			} catch {
				result.body = response.body;
			}
			return result;
		}
		const parsed = parseJsonResponse(sent);
		if (!parsed.ok) result.error = parsed.error;
		else result.body = parsed.json;
		return result;
	} catch (e) {
		return { error: { source: 'user', error: 'unexpected_error', detail: errorMessage(e) } };
	}
}
