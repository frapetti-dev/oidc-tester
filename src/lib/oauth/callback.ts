import type { CallbackResult, RunError } from '#lib/model/run.js';

const NAMED_FIELDS = [
	'code',
	'access_token',
	'id_token',
	'token_type',
	'expires_in',
	'scope',
	'state',
	'error',
	'error_description',
	'error_uri',
	'iss'
] as const;

export interface ExpectedCallback {
	/** State sent in the authorize request; `null` when none was sent (no check). */
	state: string | null;
	/** Configured issuer; empty skips the RFC 9207 `iss` check. */
	issuer: string;
}

export interface ParsedCallback {
	callback: CallbackResult;
	error: RunError | null;
}

const trimSlash = (value: string) => value.replace(/\/+$/, '');

/**
 * Reads the parameters of a captured redirect URL (query, then fragment; the fragment wins on
 * duplicate keys) and reports the first problem: authorization error, state mismatch, `iss` mismatch.
 */
export function parseCallback(url: string, expected: ExpectedCallback): ParsedCallback {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return {
			callback: { raw: {} },
			error: {
				source: 'validation',
				error: 'invalid_callback_url',
				error_description: 'The captured redirect is not a valid URL',
				detail: url
			}
		};
	}

	const raw: Record<string, string> = {};
	for (const [key, value] of parsed.searchParams) raw[key] = value;
	for (const [key, value] of new URLSearchParams(parsed.hash.replace(/^#\??/, '')))
		raw[key] = value;

	const callback: CallbackResult = { raw };
	for (const field of NAMED_FIELDS) {
		if (raw[field] !== undefined) callback[field] = raw[field];
	}

	return { callback, error: firstError(callback, expected) };
}

function firstError(callback: CallbackResult, expected: ExpectedCallback): RunError | null {
	if (callback.error !== undefined) {
		const error: RunError = { source: 'authorization', error: callback.error };
		if (callback.error_description !== undefined)
			error.error_description = callback.error_description;
		if (callback.error_uri !== undefined) error.error_uri = callback.error_uri;
		return error;
	}
	if (expected.state !== null && callback.state !== expected.state) {
		return {
			source: 'validation',
			error: 'state_mismatch',
			error_description: 'The state returned by the IdP does not match the state that was sent',
			detail: `expected: ${expected.state}\nreceived: ${callback.state ?? '(missing)'}`
		};
	}
	if (
		callback.iss !== undefined &&
		expected.issuer !== '' &&
		trimSlash(callback.iss) !== trimSlash(expected.issuer)
	) {
		return {
			source: 'validation',
			error: 'iss_mismatch',
			error_description:
				'The iss parameter of the response differs from the configured issuer (RFC 9207)',
			detail: `expected: ${expected.issuer}\nreceived: ${callback.iss}`
		};
	}
	return null;
}
