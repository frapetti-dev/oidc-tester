import { describe, expect, it } from 'vitest';
import type { Header, HttpRequestSpec } from '$lib/ipc/types';
import { newIdp } from '$lib/model/schema';
import {
	buildPreflightSpec,
	corsValidation,
	evaluateCors,
	nonSafelistedHeaders,
	shouldPreflight
} from './cors';

const ORIGIN = 'https://app.example';
const SIMPLE: Header[] = [
	['Content-Type', 'application/x-www-form-urlencoded'],
	['Accept', 'application/json']
];
const acao = (value: string): Header[] => [['Access-Control-Allow-Origin', value]];

describe('evaluateCors response check', () => {
	it('REQ-CORS-001 allows an exact origin match or *', () => {
		for (const value of [ORIGIN, '*']) {
			expect(
				evaluateCors({
					origin: ORIGIN,
					method: 'POST',
					requestHeaders: SIMPLE,
					response: { headers: acao(value) }
				})
			).toEqual({ allowed: true, reasons: [] });
		}
	});

	it('REQ-CORS-001 blocks a missing or mismatching Access-Control-Allow-Origin with a reason', () => {
		const missing = evaluateCors({
			origin: ORIGIN,
			method: 'POST',
			requestHeaders: SIMPLE,
			response: { headers: [] }
		});
		expect(missing.allowed).toBe(false);
		expect(missing.reasons).toHaveLength(1);
		expect(missing.reasons[0]).toContain('Access-Control-Allow-Origin');

		const mismatch = evaluateCors({
			origin: ORIGIN,
			method: 'POST',
			requestHeaders: SIMPLE,
			response: { headers: acao('https://other.example') }
		});
		expect(mismatch.allowed).toBe(false);
		expect(mismatch.reasons[0]).toContain('https://other.example');
	});

	it('REQ-CORS-002 rejects * for credentialed requests', () => {
		const result = evaluateCors({
			origin: ORIGIN,
			method: 'POST',
			requestHeaders: SIMPLE,
			credentials: true,
			response: { headers: [...acao('*'), ['Access-Control-Allow-Credentials', 'true']] }
		});
		expect(result.allowed).toBe(false);
		expect(result.reasons.join(' ')).toContain('*');
	});

	it('REQ-CORS-002 credentialed requests require Access-Control-Allow-Credentials: true', () => {
		const base = {
			origin: ORIGIN,
			method: 'POST',
			requestHeaders: SIMPLE,
			credentials: true
		};
		const without = evaluateCors({ ...base, response: { headers: acao(ORIGIN) } });
		expect(without.allowed).toBe(false);
		expect(without.reasons[0]).toContain('Access-Control-Allow-Credentials');
		const withIt = evaluateCors({
			...base,
			response: { headers: [...acao(ORIGIN), ['access-control-allow-credentials', 'true']] }
		});
		expect(withIt).toEqual({ allowed: true, reasons: [] });
	});
});

describe('evaluateCors preflight', () => {
	const authHeaders: Header[] = [...SIMPLE, ['Authorization', 'Basic abc'], ['X-Trace', '1']];
	const preflight = (headers: Header[], status = 204) => ({
		status,
		headers: [...acao(ORIGIN), ...headers]
	});

	it('REQ-CORS-003 a POST with form-urlencoded content type and only safelisted headers needs no preflight', () => {
		expect(nonSafelistedHeaders([...SIMPLE, ['Origin', ORIGIN]])).toEqual([]);
		expect(
			evaluateCors({
				origin: ORIGIN,
				method: 'POST',
				requestHeaders: SIMPLE,
				response: { headers: acao(ORIGIN) }
			}).allowed
		).toBe(true);
	});

	it('REQ-CORS-003 non-safelisted headers are Authorization, custom headers and non-simple content types', () => {
		expect(
			nonSafelistedHeaders([
				['Content-Type', 'application/json'],
				['authorization', 'x'],
				['X-Trace', '1'],
				['Accept', '*/*']
			])
		).toEqual(['authorization', 'content-type', 'x-trace']);
	});

	it('REQ-CORS-003 requires every non-safelisted header in Access-Control-Allow-Headers, case-insensitively', () => {
		const ok = evaluateCors({
			origin: ORIGIN,
			method: 'POST',
			requestHeaders: authHeaders,
			preflight: preflight([['Access-Control-Allow-Headers', 'AUTHORIZATION, x-trace']]),
			response: { headers: acao(ORIGIN) }
		});
		expect(ok).toEqual({ allowed: true, reasons: [] });

		const missing = evaluateCors({
			origin: ORIGIN,
			method: 'POST',
			requestHeaders: authHeaders,
			preflight: preflight([['Access-Control-Allow-Headers', 'x-trace']]),
			response: { headers: acao(ORIGIN) }
		});
		expect(missing.allowed).toBe(false);
		expect(missing.reasons).toHaveLength(1);
		expect(missing.reasons[0]).toContain('authorization');
		expect(missing.reasons[0]).not.toContain('x-trace');
	});

	it('REQ-CORS-003 Access-Control-Allow-Headers * covers custom headers but never Authorization', () => {
		const result = evaluateCors({
			origin: ORIGIN,
			method: 'POST',
			requestHeaders: authHeaders,
			preflight: preflight([['Access-Control-Allow-Headers', '*']]),
			response: { headers: acao(ORIGIN) }
		});
		expect(result.allowed).toBe(false);
		expect(result.reasons[0]).toContain('authorization');
		expect(result.reasons[0]).not.toContain('x-trace');
	});

	it('REQ-CORS-003 a non-safelisted method must be in Access-Control-Allow-Methods', () => {
		const headers: Header[] = [['Accept', 'application/json']];
		const denied = evaluateCors({
			origin: ORIGIN,
			method: 'PUT',
			requestHeaders: headers,
			preflight: preflight([['Access-Control-Allow-Methods', 'GET, POST']]),
			response: { headers: acao(ORIGIN) }
		});
		expect(denied.allowed).toBe(false);
		expect(denied.reasons[0]).toContain('PUT');
		const allowed = evaluateCors({
			origin: ORIGIN,
			method: 'PUT',
			requestHeaders: headers,
			preflight: preflight([['Access-Control-Allow-Methods', 'GET, PUT']]),
			response: { headers: acao(ORIGIN) }
		});
		expect(allowed.allowed).toBe(true);
	});

	it('REQ-CORS-003 a failing preflight status or origin blocks, and a missing required preflight is reported', () => {
		const badStatus = evaluateCors({
			origin: ORIGIN,
			method: 'POST',
			requestHeaders: authHeaders,
			preflight: preflight([['Access-Control-Allow-Headers', 'authorization, x-trace']], 403),
			response: { headers: acao(ORIGIN) }
		});
		expect(badStatus.allowed).toBe(false);
		expect(badStatus.reasons[0]).toContain('403');

		const badOrigin = evaluateCors({
			origin: ORIGIN,
			method: 'POST',
			requestHeaders: authHeaders,
			preflight: {
				status: 200,
				headers: [['Access-Control-Allow-Headers', 'authorization, x-trace']]
			},
			response: { headers: acao(ORIGIN) }
		});
		expect(badOrigin.allowed).toBe(false);
		expect(badOrigin.reasons[0]).toContain('Access-Control-Allow-Origin');

		const none = evaluateCors({
			origin: ORIGIN,
			method: 'POST',
			requestHeaders: authHeaders,
			response: { headers: acao(ORIGIN) }
		});
		expect(none.allowed).toBe(false);
		expect(none.reasons[0]).toContain('preflight');
	});

	it('REQ-CORS-003 a preflight for a simple request is ignored', () => {
		const result = evaluateCors({
			origin: ORIGIN,
			method: 'POST',
			requestHeaders: SIMPLE,
			preflight: { status: 500, headers: [] },
			response: { headers: acao(ORIGIN) }
		});
		expect(result).toEqual({ allowed: true, reasons: [] });
	});
});

describe('preflight request', () => {
	const tokenSpec = (headers: Header[]): HttpRequestSpec => ({
		method: 'POST',
		url: 'https://idp.test/token',
		headers,
		body: 'grant_type=x',
		tlsInsecure: false,
		proxy: { mode: 'system', url: null },
		timeoutMs: 5000
	});

	it('REQ-CORS-004 is only sent when corsCheck is on and origin is non-empty', () => {
		const idp = newIdp();
		expect(shouldPreflight(idp)).toBe(false);
		idp.http.corsCheck = true;
		expect(shouldPreflight(idp)).toBe(false);
		idp.http.origin = '   ';
		expect(shouldPreflight(idp)).toBe(false);
		idp.http.origin = ORIGIN;
		expect(shouldPreflight(idp)).toBe(true);
		idp.http.corsCheck = false;
		expect(shouldPreflight(idp)).toBe(false);
	});

	it('REQ-CORS-004 OPTIONS carries Origin, Access-Control-Request-Method and a lowercase sorted header list, without the IdP custom headers', () => {
		const idp = newIdp();
		idp.http.origin = ORIGIN;
		idp.http.corsCheck = true;
		idp.http.headers = [{ name: 'X-Idp', value: '1', enabled: true }];
		const spec = buildPreflightSpec(
			idp,
			tokenSpec([
				['X-Idp', '1'],
				['Origin', ORIGIN],
				['Content-Type', 'application/x-www-form-urlencoded'],
				['Authorization', 'Basic abc'],
				['Accept', 'application/json']
			])
		);
		expect(spec.method).toBe('OPTIONS');
		expect(spec.url).toBe('https://idp.test/token');
		expect(spec.body).toBeNull();
		expect(spec.headers).toEqual([
			['Origin', ORIGIN],
			['Access-Control-Request-Method', 'POST'],
			['Access-Control-Request-Headers', 'authorization,x-idp']
		]);
	});

	it('REQ-CORS-004 omits Access-Control-Request-Headers when every header is safelisted', () => {
		const idp = newIdp();
		idp.http.origin = ORIGIN;
		idp.http.corsCheck = true;
		const spec = buildPreflightSpec(idp, tokenSpec([['Accept', 'application/json']]));
		expect(spec.headers.map(([n]) => n)).toEqual(['Origin', 'Access-Control-Request-Method']);
	});
});

describe('corsValidation', () => {
	it('REQ-CORS-005 blocked results become a warn row with the exact literal', () => {
		expect(corsValidation({ allowed: false, reasons: ['a', 'b'] }, ORIGIN)).toEqual({
			id: 'cors',
			level: 'warn',
			message: `Browser at ${ORIGIN} would block this request: a; b`
		});
	});

	it('REQ-CORS-005 allowed results become an ok row with the exact literal', () => {
		expect(corsValidation({ allowed: true, reasons: [] }, ORIGIN)).toEqual({
			id: 'cors',
			level: 'ok',
			message: `CORS allowed for ${ORIGIN}`
		});
	});
});
