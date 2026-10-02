import { z } from 'zod';
import type { RunError, Tokens } from '$lib/model/run';
import type { SendResult } from './transport';

const DETAIL_LIMIT = 2048;

const JsonObject = z.record(z.string(), z.unknown());
const optionalString = z.string().optional().catch(undefined);
const OAuthErrorBody = z.object({
	error: z.string(),
	error_description: optionalString,
	error_uri: optionalString
});
const TokenBody = z.object({
	access_token: z.string().min(1),
	id_token: optionalString,
	refresh_token: optionalString,
	token_type: optionalString,
	scope: optionalString,
	expires_in: z
		.union([z.number().finite(), z.string().regex(/^\d+$/).transform(Number)])
		.optional()
		.catch(undefined)
});

export type JsonResponse =
	{ ok: true; json: Record<string, unknown> } | { ok: false; error: RunError };

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * Classifies the outcome of a back-channel POST: a transport failure, an OAuth error object
 * (`error` in the JSON body, whatever the status), a non-JSON / non-2xx body (`invalid_response`),
 * or the parsed JSON object of a 2xx response.
 */
export function parseJsonResponse(result: SendResult): JsonResponse {
	const { final, failure } = result;
	if (failure) {
		return {
			ok: false,
			error: {
				source: failure.kind === 'tls' ? 'tls' : 'network',
				error: failure.kind,
				detail: failure.message
			}
		};
	}
	if (!final) {
		return {
			ok: false,
			error: { source: 'network', error: 'other', detail: result.error ?? 'No response received' }
		};
	}
	const { status, body } = final.response;
	const object = JsonObject.safeParse(parseJson(body));
	const oauthError = OAuthErrorBody.safeParse(object.data);
	if (oauthError.success) {
		const { error, error_description, error_uri } = oauthError.data;
		const runError: RunError = { source: 'token', error, httpStatus: status };
		if (error_description !== undefined) runError.error_description = error_description;
		if (error_uri !== undefined) runError.error_uri = error_uri;
		return { ok: false, error: runError };
	}
	if (status < 200 || status > 299 || !object.success) {
		return {
			ok: false,
			error: {
				source: 'token',
				error: 'invalid_response',
				httpStatus: status,
				detail: body.slice(0, DETAIL_LIMIT)
			}
		};
	}
	return { ok: true, json: object.data };
}

/** Parses a token endpoint response into `Tokens` or a `RunError`. */
export function parseTokenResponse(result: SendResult): { tokens?: Tokens; error?: RunError } {
	const parsed = parseJsonResponse(result);
	if (!parsed.ok) return { error: parsed.error };
	const body = TokenBody.safeParse(parsed.json);
	if (!body.success) {
		return {
			error: {
				source: 'token',
				error: 'invalid_response',
				error_description: 'The token response has no access_token',
				httpStatus: result.final?.response.status,
				detail: (result.final?.response.body ?? '').slice(0, DETAIL_LIMIT)
			}
		};
	}
	const { access_token, id_token, refresh_token, token_type, scope, expires_in } = body.data;
	const tokens: Tokens = { access_token, raw: parsed.json };
	if (id_token !== undefined) tokens.id_token = id_token;
	if (refresh_token !== undefined) tokens.refresh_token = refresh_token;
	if (token_type !== undefined) tokens.token_type = token_type;
	if (expires_in !== undefined) tokens.expires_in = expires_in;
	if (scope !== undefined) tokens.scope = scope;
	return { tokens };
}
