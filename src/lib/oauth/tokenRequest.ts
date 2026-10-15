import type { Header, HttpRequestSpec, IpcApi } from '#lib/ipc/types.js';
import type { RunError, Tokens, Validation } from '#lib/model/run.js';
import type { Client, Flow, Idp, KV } from '#lib/model/schema.js';
import { applyClientAuth, type Param } from './clientAuth';
import {
	buildPreflightSpec,
	corsValidation,
	evaluateCors,
	shouldPreflight,
	type CorsCheck
} from './cors';
import { parseTokenResponse } from './tokenResponse';
import { buildRequestSpec, sendWithRedirects, type HttpLog } from './transport';

export const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

export type Grant =
	| { type: 'authorization_code'; code: string; redirectUri: string; codeVerifier?: string | null }
	| { type: 'client_credentials' }
	| { type: 'password'; username: string; password: string }
	| { type: 'refresh_token'; refreshToken: string }
	| { type: 'device_code'; deviceCode: string };

export interface TokenRequestInput {
	idp: Idp;
	client: Client;
	flow: Flow;
	grant: Grant;
	/** Client secret from the keychain; null when none is stored. */
	secret: string | null;
	/** Clock in epoch milliseconds (client_secret_jwt `iat`/`exp`). */
	now?: () => number;
}

export type BuiltTokenRequest =
	{ ok: true; spec: HttpRequestSpec } | { ok: false; error: RunError };

/** Non-empty values only, in a stable order. */
function optionalParams(entries: [string, string][]): Param[] {
	return entries.filter(([, value]) => value !== '');
}

function grantParams(flow: Flow, grant: Grant): Param[] {
	const { scope, audience, resource } = flow.params;
	switch (grant.type) {
		case 'authorization_code':
			return [
				['grant_type', 'authorization_code'],
				['code', grant.code],
				['redirect_uri', grant.redirectUri],
				...optionalParams([['code_verifier', grant.codeVerifier ?? '']])
			];
		case 'client_credentials':
			return [
				['grant_type', 'client_credentials'],
				...optionalParams([
					['scope', scope],
					['audience', audience],
					['resource', resource]
				])
			];
		case 'password':
			return [
				['grant_type', 'password'],
				['username', grant.username],
				['password', grant.password],
				...optionalParams([['scope', scope]])
			];
		case 'refresh_token':
			return [
				['grant_type', 'refresh_token'],
				['refresh_token', grant.refreshToken],
				...optionalParams([['scope', scope]])
			];
		case 'device_code':
			return [
				['grant_type', DEVICE_CODE_GRANT_TYPE],
				['device_code', grant.deviceCode]
			];
	}
}

/**
 * Appends the enabled, named extra params; an extra param replaces every built-in param
 * of the same name.
 */
export function withExtraParams(params: Param[], extra: KV[]): Param[] {
	const usable = extra.filter((kv) => kv.enabled && kv.name.trim() !== '');
	const overridden = new Set(usable.map((kv) => kv.name.trim()));
	return [
		...params.filter(([name]) => !overridden.has(name)),
		...usable.map((kv): Param => [kv.name.trim(), kv.value])
	];
}

/** Builds the token endpoint POST (form body, client auth, merged headers) for a grant. */
export async function buildTokenRequest(input: TokenRequestInput): Promise<BuiltTokenRequest> {
	const { idp, client, flow, grant, secret } = input;
	const protocolHeaders: Header[] = [
		['Content-Type', 'application/x-www-form-urlencoded'],
		['Accept', 'application/json']
	];
	const auth = await applyClientAuth(
		{ headers: protocolHeaders, params: grantParams(flow, grant) },
		client,
		secret,
		idp.endpoints.token,
		input.now
	);
	if (!auth.ok) return auth;
	const params = withExtraParams(auth.params, flow.params.extraTokenParams);
	return {
		ok: true,
		spec: buildRequestSpec(idp, flow, {
			method: 'POST',
			url: idp.endpoints.token,
			protocolHeaders: auth.headers,
			body: new URLSearchParams(params).toString()
		})
	};
}

export interface TokenResult {
	tokens?: Tokens;
	error?: RunError;
	validations: Validation[];
}

/**
 * Builds, sends and parses one token request. When the IdP has `corsCheck` and an origin, an
 * OPTIONS preflight is sent first and the browser verdict is reported as a `cors` validation;
 * the real request is sent regardless.
 */
export async function requestTokens(
	ipc: IpcApi,
	input: TokenRequestInput & { log: HttpLog }
): Promise<TokenResult> {
	const built = await buildTokenRequest(input);
	if (!built.ok) return { error: built.error, validations: [] };
	const { idp, log } = input;
	const { spec } = built;

	let preflight: CorsCheck['preflight'];
	if (shouldPreflight(idp)) {
		const sent = await sendWithRedirects(ipc, buildPreflightSpec(idp, spec), log);
		preflight = sent.final
			? { status: sent.final.response.status, headers: sent.final.response.headers }
			: { error: sent.failure?.message ?? sent.error ?? 'no response' };
	}

	const sent = await sendWithRedirects(ipc, spec, log);
	const validations: Validation[] = [];
	if (shouldPreflight(idp) && sent.final) {
		const origin = idp.http.origin.trim();
		const verdict = evaluateCors({
			origin,
			method: spec.method,
			requestHeaders: spec.headers,
			preflight,
			response: { headers: sent.final.response.headers }
		});
		validations.push(corsValidation(verdict, origin));
	}
	return { ...parseTokenResponse(sent), validations };
}
