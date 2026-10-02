import type { Header, HttpRequestSpec } from '$lib/ipc/types';
import type { Validation } from '$lib/model/run';
import type { Idp } from '$lib/model/schema';
import { buildRequestSpec, headerValue } from './transport';

export interface CorsResponse {
	headers: Header[];
}

export interface CorsPreflightResponse extends CorsResponse {
	status: number;
}

export interface CorsPreflightFailure {
	/** The OPTIONS request itself failed (no response). */
	error: string;
}

export interface CorsCheck {
	/** Origin the simulated browser page runs at. */
	origin: string;
	method: string;
	/** Headers of the actual request; browser-managed ones (Origin, Host, …) are ignored. */
	requestHeaders: Header[];
	/** Credentialed request (cookies/HTTP auth); fetch default for cross-origin is false. */
	credentials?: boolean;
	/** Response to the OPTIONS preflight, if one was sent. Ignored when the request is simple. */
	preflight?: CorsPreflightResponse | CorsPreflightFailure;
	/** Response to the actual request. */
	response: CorsResponse;
}

export interface CorsResult {
	allowed: boolean;
	reasons: string[];
}

const SAFELISTED_METHODS = ['GET', 'HEAD', 'POST'];
const SAFELISTED_HEADERS = ['accept', 'accept-language', 'content-language'];
const SIMPLE_CONTENT_TYPES = [
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain'
];
/** Headers a browser sets itself; scripts cannot send them, so they never trigger a preflight. */
const BROWSER_MANAGED_HEADERS = [
	'origin',
	'host',
	'content-length',
	'user-agent',
	'connection',
	'accept-encoding',
	'referer',
	'cookie'
];

function isSafelisted(name: string, value: string): boolean {
	if (SAFELISTED_HEADERS.includes(name)) return true;
	if (name === 'content-type') {
		return SIMPLE_CONTENT_TYPES.includes(value.split(';')[0].trim().toLowerCase());
	}
	return false;
}

/** Lowercase, de-duplicated, sorted names of request headers that force a preflight. */
export function nonSafelistedHeaders(headers: Header[]): string[] {
	const names = headers
		.map(([name, value]): Header => [name.trim().toLowerCase(), value])
		.filter(
			([name, value]) => !BROWSER_MANAGED_HEADERS.includes(name) && !isSafelisted(name, value)
		)
		.map(([name]) => name);
	return [...new Set(names)].sort();
}

function parseList(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((v) => v.trim())
		.filter((v) => v !== '');
}

function checkAllowOrigin(
	label: string,
	headers: Header[],
	origin: string,
	credentials: boolean,
	reasons: string[]
): void {
	const allowOrigin = headerValue(headers, 'access-control-allow-origin');
	if (allowOrigin === undefined) {
		reasons.push(`${label} has no Access-Control-Allow-Origin header`);
	} else if (allowOrigin === '*') {
		if (credentials) {
			reasons.push(
				`${label} Access-Control-Allow-Origin is '*', which is not allowed for credentialed requests`
			);
		}
	} else if (allowOrigin !== origin) {
		reasons.push(
			`${label} Access-Control-Allow-Origin '${allowOrigin}' does not match origin '${origin}'`
		);
	}
	if (credentials && headerValue(headers, 'access-control-allow-credentials') !== 'true') {
		reasons.push(
			`${label} lacks Access-Control-Allow-Credentials: true required for credentialed requests`
		);
	}
}

/** Fetch-standard CORS check as a browser at `origin` would perform it. */
export function evaluateCors(check: CorsCheck): CorsResult {
	const { origin, requestHeaders, response } = check;
	const credentials = check.credentials ?? false;
	const method = check.method.toUpperCase();
	const reasons: string[] = [];
	const unsafeHeaders = nonSafelistedHeaders(requestHeaders);
	const needsPreflight = !SAFELISTED_METHODS.includes(method) || unsafeHeaders.length > 0;

	if (needsPreflight) {
		const { preflight } = check;
		if (!preflight) {
			const why = !SAFELISTED_METHODS.includes(method)
				? `method ${method}`
				: `headers ${unsafeHeaders.join(', ')}`;
			reasons.push(`A preflight is required for ${why}, but no preflight response is available`);
		} else if ('error' in preflight) {
			reasons.push(`Preflight request failed: ${preflight.error}`);
		} else {
			if (preflight.status < 200 || preflight.status > 299) {
				reasons.push(`Preflight returned HTTP ${preflight.status}, expected 2xx`);
			}
			checkAllowOrigin('Preflight', preflight.headers, origin, credentials, reasons);
			if (!SAFELISTED_METHODS.includes(method)) {
				const allowed = parseList(headerValue(preflight.headers, 'access-control-allow-methods'));
				const wildcard = !credentials && allowed.includes('*');
				if (!wildcard && !allowed.includes(method)) {
					reasons.push(`Preflight Access-Control-Allow-Methods does not allow ${method}`);
				}
			}
			const allowedHeaders = parseList(
				headerValue(preflight.headers, 'access-control-allow-headers')
			).map((h) => h.toLowerCase());
			const wildcard = !credentials && allowedHeaders.includes('*');
			const denied = unsafeHeaders.filter(
				(h) => !allowedHeaders.includes(h) && !(wildcard && h !== 'authorization')
			);
			if (denied.length > 0) {
				reasons.push(`Preflight Access-Control-Allow-Headers does not allow: ${denied.join(', ')}`);
			}
		}
	}
	checkAllowOrigin('Response', response.headers, origin, credentials, reasons);
	return { allowed: reasons.length === 0, reasons };
}

/** A preflight is simulated only when the IdP enables the CORS check and sets an origin. */
export function shouldPreflight(idp: Idp): boolean {
	return idp.http.corsCheck && idp.http.origin.trim() !== '';
}

/**
 * The OPTIONS request a browser would send before `tokenSpec`. Like a real preflight it carries
 * no custom (IdP/flow) headers: only `Origin` from the IdP settings and the Access-Control-Request-* pair.
 */
export function buildPreflightSpec(idp: Idp, tokenSpec: HttpRequestSpec): HttpRequestSpec {
	const requested = nonSafelistedHeaders(tokenSpec.headers);
	const protocolHeaders: Header[] = [['Access-Control-Request-Method', tokenSpec.method]];
	if (requested.length > 0) {
		protocolHeaders.push(['Access-Control-Request-Headers', requested.join(',')]);
	}
	const bare: Idp = { ...idp, http: { ...idp.http, headers: [] } };
	return buildRequestSpec(bare, null, { method: 'OPTIONS', url: tokenSpec.url, protocolHeaders });
}

export function corsValidation(result: CorsResult, origin: string): Validation {
	return result.allowed
		? { id: 'cors', level: 'ok', message: `CORS allowed for ${origin}` }
		: {
				id: 'cors',
				level: 'warn',
				message: `Browser at ${origin} would block this request: ${result.reasons.join('; ')}`
			};
}
