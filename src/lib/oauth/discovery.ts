import type { IpcApi } from '#lib/ipc/types.js';
import type { RunError } from '#lib/model/run.js';
import type { Endpoints, Flow, Idp } from '#lib/model/schema.js';
import { effectiveResponseType, isFrontChannel } from './authorize';
import { buildRequestSpec, sendWithRedirects, type HttpLog } from './transport';

export type DiscoveryResult =
	| {
			ok: true;
			document: Record<string, unknown>;
			endpoints: Partial<Endpoints>;
			warnings: string[];
			discoveredAt: string;
	  }
	| { ok: false; error: RunError };

export type DiscoverySuccess = Extract<DiscoveryResult, { ok: true }>;

export interface DiscoverySuggestions {
	grantTypes: string[];
	responseTypes: string[];
	scopes: string[];
	tokenAuthMethods: string[];
	codeChallengeMethods: string[];
	responseModes: string[];
}

const ENDPOINT_FIELDS: Record<keyof Endpoints, string> = {
	authorization: 'authorization_endpoint',
	token: 'token_endpoint',
	userinfo: 'userinfo_endpoint',
	jwks: 'jwks_uri',
	deviceAuthorization: 'device_authorization_endpoint',
	endSession: 'end_session_endpoint'
};

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const BODY_EXCERPT = 2048;

const trimSlash = (value: string) => value.replace(/\/+$/, '');

const invalid = (error: string, error_description: string, extra: Partial<RunError> = {}) =>
	({ ok: false, error: { source: 'validation', error, error_description, ...extra } }) as const;

/**
 * Fetches provider metadata: `<issuer>/.well-known/openid-configuration`, then (only on 404) the
 * RFC 8414 `oauth-authorization-server` URL with the issuer path inserted after the well-known
 * segment. Every hop is recorded in `log`. Never throws; failures are `{ ok: false, error }`.
 */
export async function discover(
	ipc: IpcApi,
	idp: Idp,
	log: HttpLog,
	now: () => Date = () => new Date()
): Promise<DiscoveryResult> {
	const configured = trimSlash(idp.issuer.trim());
	if (configured === '') return invalid('missing_issuer', 'The issuer is empty');
	let issuerUrl: URL;
	try {
		issuerUrl = new URL(configured);
	} catch {
		return invalid('invalid_issuer', `The issuer is not a valid URL: ${configured}`);
	}

	const urls = [
		`${configured}/.well-known/openid-configuration`,
		`${issuerUrl.origin}/.well-known/oauth-authorization-server${trimSlash(issuerUrl.pathname)}`
	];

	let status = 0;
	let body = '';
	for (const url of urls) {
		const spec = buildRequestSpec(idp, null, {
			method: 'GET',
			url,
			protocolHeaders: [['Accept', 'application/json']]
		});
		const sent = await sendWithRedirects(ipc, spec, log);
		if (sent.failure) {
			return {
				ok: false,
				error: {
					source: sent.failure.kind === 'tls' ? 'tls' : 'network',
					error: sent.failure.kind,
					detail: sent.failure.message
				}
			};
		}
		if (sent.error !== undefined || sent.final === null) {
			return {
				ok: false,
				error: {
					source: 'network',
					error: 'too_many_redirects',
					detail: sent.error ?? 'No response received'
				}
			};
		}
		status = sent.final.response.status;
		body = sent.final.response.body;
		if (status !== 404) break;
	}

	const excerpt = body.slice(0, BODY_EXCERPT);
	if (status < 200 || status > 299) {
		return invalid('discovery_http_error', `Discovery endpoint answered HTTP ${status}`, {
			httpStatus: status,
			detail: excerpt
		});
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return invalid('discovery_invalid_json', 'The discovery response is not valid JSON', {
			httpStatus: status,
			detail: excerpt
		});
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return invalid('discovery_invalid_document', 'The discovery document is not a JSON object', {
			httpStatus: status,
			detail: excerpt
		});
	}
	const document = parsed as Record<string, unknown>;
	if (typeof document.issuer !== 'string' || document.issuer === '') {
		return invalid('discovery_missing_issuer', 'The discovery document has no issuer', {
			httpStatus: status,
			detail: excerpt
		});
	}

	const endpoints: Partial<Endpoints> = {};
	for (const [field, key] of Object.entries(ENDPOINT_FIELDS) as Array<[keyof Endpoints, string]>) {
		const value = document[key];
		if (typeof value === 'string' && value !== '') endpoints[field] = value;
	}
	const warnings: string[] = [];
	if (trimSlash(document.issuer) !== configured) {
		warnings.push(
			`Issuer in discovery document (${document.issuer}) differs from configured issuer (${configured})`
		);
	}
	return { ok: true, document, endpoints, warnings, discoveredAt: now().toISOString() };
}

/**
 * New endpoints for `idp`: discovered values fill empty fields only, or replace every discovered
 * field when `overwrite` ("Apply all"). A failed discovery changes nothing.
 */
export function applyDiscovery(
	idp: Idp,
	result: DiscoveryResult,
	options: { overwrite: boolean }
): Endpoints {
	const next = { ...idp.endpoints };
	if (!result.ok) return next;
	for (const [field, value] of Object.entries(result.endpoints) as Array<
		[keyof Endpoints, string]
	>) {
		if (options.overwrite || next[field].trim() === '') next[field] = value;
	}
	return next;
}

const stringList = (document: Record<string, unknown>, key: string): string[] => {
	const value = document[key];
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
};

/** Supported-value lists used for datalist suggestions in the flow and IdP editors. */
export function discoverySuggestions(document: Record<string, unknown>): DiscoverySuggestions {
	return {
		grantTypes: stringList(document, 'grant_types_supported'),
		responseTypes: stringList(document, 'response_types_supported'),
		scopes: stringList(document, 'scopes_supported'),
		tokenAuthMethods: stringList(document, 'token_endpoint_auth_methods_supported'),
		codeChallengeMethods: stringList(document, 'code_challenge_methods_supported'),
		responseModes: stringList(document, 'response_modes_supported')
	};
}

const GRANT_TYPE_BY_FLOW: Record<Flow['type'], string> = {
	authorization_code: 'authorization_code',
	authorization_code_pkce: 'authorization_code',
	hybrid: 'authorization_code',
	implicit: 'implicit',
	client_credentials: 'client_credentials',
	password: 'password',
	refresh_token: 'refresh_token',
	device_code: DEVICE_GRANT
};

const tokenSet = (responseType: string) =>
	[...new Set(responseType.split(/\s+/).filter(Boolean))].sort().join(' ');

/**
 * Warnings for a flow whose grant type or `response_type` the discovery document does not list.
 * Lists that are absent (or not arrays) are not checked; `response_type` is compared as an
 * unordered set of tokens.
 */
export function unsupportedWarnings(
	flow: Flow,
	document: Record<string, unknown> | null
): string[] {
	if (document === null) return [];
	const warnings: string[] = [];

	const grants = document.grant_types_supported;
	const grant = GRANT_TYPE_BY_FLOW[flow.type];
	if (Array.isArray(grants) && !grants.includes(grant)) {
		warnings.push(`Grant type "${grant}" is not listed in grant_types_supported`);
	}

	const responseTypes = document.response_types_supported;
	if (isFrontChannel(flow) && Array.isArray(responseTypes)) {
		const responseType = effectiveResponseType(flow);
		const wanted = tokenSet(responseType);
		const listed = responseTypes.some((r) => typeof r === 'string' && tokenSet(r) === wanted);
		if (!listed) {
			warnings.push(`response_type "${responseType}" is not listed in response_types_supported`);
		}
	}
	return warnings;
}
