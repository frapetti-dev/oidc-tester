import type { RunError } from '$lib/model/run';
import type { Flow, FlowParams, Idp } from '$lib/model/schema';
import { challenge, generateVerifier, randomToken } from './pkce';

/** Per-run random inputs of the authorize request; the engine keeps them to validate the response. */
export interface AuthorizeValues {
	state: string;
	nonce: string | null;
	codeVerifier: string | null;
}

export type AuthorizeUrlResult = { ok: true; url: string } | { ok: false; error: RunError };

export type AuthorizePreview =
	| { ok: true; url: string; values: AuthorizeValues }
	| { ok: false; message: string; values: AuthorizeValues };

/** `form_post` is intentionally absent: the navigation hook only sees URLs, not POST bodies. */
export const RESPONSE_MODE_OPTIONS: ReadonlyArray<{
	value: FlowParams['responseMode'];
	label: string;
}> = [
	{ value: '', label: 'default (omit)' },
	{ value: 'query', label: 'query' },
	{ value: 'fragment', label: 'fragment' }
];

const FRONT_CHANNEL_TYPES: ReadonlySet<Flow['type']> = new Set([
	'authorization_code',
	'authorization_code_pkce',
	'implicit',
	'hybrid'
]);

const DEFAULT_RESPONSE_TYPES: Partial<Record<Flow['type'], string>> = {
	authorization_code: 'code',
	authorization_code_pkce: 'code',
	implicit: 'id_token token',
	hybrid: 'code id_token'
};

export const isFrontChannel = (flow: Flow): boolean => FRONT_CHANNEL_TYPES.has(flow.type);

/** PKCE is always on for `authorization_code_pkce`, opt-in via `usePkce` for hybrid. */
export function usesPkce(flow: Flow): boolean {
	return flow.type === 'authorization_code_pkce' || (flow.type === 'hybrid' && flow.params.usePkce);
}

/** The configured `responseType`, or the flow type's default when it is blank. */
export function effectiveResponseType(flow: Flow): string {
	return flow.params.responseType.trim() || (DEFAULT_RESPONSE_TYPES[flow.type] ?? '');
}

const responseTypeTokens = (responseType: string) => responseType.split(/\s+/).filter(Boolean);

/**
 * Resolves state, nonce and PKCE verifier according to the flow's modes.
 * `auto` values are fresh unless `existing` supplies one (used by the live preview so it does not
 * flicker); `fixed` always follows the flow; nonce `off` is `null` (the builder rejects it when an
 * id_token is requested).
 */
export function generateAuthorizeValues(
	flow: Flow,
	existing?: Partial<AuthorizeValues>
): AuthorizeValues {
	const { state, nonce } = flow.params;
	return {
		state: state.mode === 'fixed' ? state.value : (existing?.state ?? randomToken()),
		nonce:
			nonce.mode === 'off'
				? null
				: nonce.mode === 'fixed'
					? nonce.value
					: (existing?.nonce ?? randomToken()),
		codeVerifier: usesPkce(flow) ? (existing?.codeVerifier ?? generateVerifier()) : null
	};
}

const validationError = (error: string, error_description: string): AuthorizeUrlResult => ({
	ok: false,
	error: { source: 'validation', error, error_description }
});

/** Builds the front-channel authorization request URL (OIDC Core §3.1.2.1, RFC 7636, RFC 6749 §4). */
export async function buildAuthorizeUrl(
	idp: Idp,
	flow: Flow,
	generated: AuthorizeValues
): Promise<AuthorizeUrlResult> {
	if (!isFrontChannel(flow)) {
		return validationError(
			'unsupported_flow',
			`Flow type ${flow.type} does not use the authorization endpoint`
		);
	}
	const endpoint = idp.endpoints.authorization.trim();
	if (endpoint === '') {
		return validationError('missing_authorization_endpoint', 'The authorization endpoint is empty');
	}
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return validationError(
			'invalid_authorization_endpoint',
			`The authorization endpoint is not a valid URL: ${endpoint}`
		);
	}

	const { params } = flow;
	const responseType = effectiveResponseType(flow);
	const nonce = params.nonce.mode === 'off' ? null : generated.nonce;
	if (nonce === null && responseTypeTokens(responseType).includes('id_token')) {
		return validationError(
			'nonce_required',
			'nonce is required for response_type containing id_token'
		);
	}

	const query: Array<[string, string]> = [
		['response_type', responseType],
		['client_id', idp.client.clientId],
		['redirect_uri', params.redirectUri],
		['scope', params.scope],
		['state', generated.state]
	];
	if (nonce !== null) query.push(['nonce', nonce]);
	if (params.responseMode !== '') query.push(['response_mode', params.responseMode]);
	if (usesPkce(flow)) {
		if (generated.codeVerifier === null) {
			return validationError(
				'missing_code_verifier',
				'A PKCE code verifier is required for this flow'
			);
		}
		query.push(
			['code_challenge', await challenge(generated.codeVerifier, params.pkceMethod)],
			['code_challenge_method', params.pkceMethod]
		);
	}
	const optional: Array<[string, string]> = [
		['prompt', params.prompt],
		['login_hint', params.loginHint],
		['max_age', params.maxAge],
		['acr_values', params.acrValues],
		['ui_locales', params.uiLocales],
		['claims', params.claims]
	];
	for (const [name, value] of optional) if (value !== '') query.push([name, value]);

	const builtIn = new Set(query.map(([name]) => name));
	const overridden = new Set<string>();
	for (const row of params.extraAuthParams) {
		const name = row.name.trim();
		if (!row.enabled || name === '') continue;
		if (builtIn.has(name) && !overridden.has(name)) {
			overridden.add(name);
			const index = query.findIndex(([n]) => n === name);
			query[index] = [name, row.value];
		} else {
			query.push([name, row.value]);
		}
	}

	for (const [name, value] of query) url.searchParams.append(name, value);
	return { ok: true, url: url.href };
}

/**
 * Pure helper for the flow editor's read-only preview. Pass the previously returned `values` back in
 * so auto-generated state/nonce/verifier stay stable while the user edits other fields.
 */
export async function previewAuthorizeUrl(
	idp: Idp,
	flow: Flow,
	existing?: Partial<AuthorizeValues>
): Promise<AuthorizePreview> {
	const values = generateAuthorizeValues(flow, existing);
	const result = await buildAuthorizeUrl(idp, flow, values);
	return result.ok
		? { ok: true, url: result.url, values }
		: { ok: false, message: result.error.error_description ?? result.error.error, values };
}
