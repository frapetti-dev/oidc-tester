import { describe, expect, it } from 'vitest';
import type { HttpExchange, HttpFailure, HttpFailureKind } from '#lib/ipc/types.js';
import { parseTokenResponse } from './tokenResponse';

function exchange(status: number, body: string, contentType = 'application/json'): HttpExchange {
	return {
		id: 'ex1',
		startedAt: '2026-01-01T00:00:00Z',
		durationMs: 3,
		request: { method: 'POST', url: 'https://idp.test/token', headers: [], body: '' },
		response: {
			status,
			statusText: '',
			httpVersion: 'HTTP/1.1',
			headers: [['Content-Type', contentType]],
			body,
			bodyBase64: null
		}
	};
}

const failure = (kind: HttpFailureKind, message: string): HttpFailure => ({
	kind,
	message,
	request: { method: 'POST', url: 'https://idp.test/token', headers: [], body: '' }
});

describe('parseTokenResponse', () => {
	it('REQ-FLOW-009 2xx JSON with access_token yields tokens including the raw object', () => {
		const raw = {
			access_token: 'at',
			id_token: 'idt',
			refresh_token: 'rt',
			token_type: 'Bearer',
			expires_in: 3600,
			scope: 'openid profile',
			custom: { nested: true }
		};
		const result = parseTokenResponse({ final: exchange(200, JSON.stringify(raw)), failure: null });
		expect(result.error).toBeUndefined();
		expect(result.tokens).toEqual({
			access_token: 'at',
			id_token: 'idt',
			refresh_token: 'rt',
			token_type: 'Bearer',
			expires_in: 3600,
			scope: 'openid profile',
			raw
		});
	});

	it('REQ-FLOW-009 numeric-string expires_in becomes a number and absent fields stay absent', () => {
		const result = parseTokenResponse({
			final: exchange(200, '{"access_token":"at","expires_in":"120"}'),
			failure: null
		});
		expect(result.tokens?.expires_in).toBe(120);
		expect(result.tokens).not.toHaveProperty('refresh_token');
	});

	it('REQ-FLOW-009 a 2xx JSON object without access_token is an invalid_response', () => {
		const result = parseTokenResponse({ final: exchange(200, '{"foo":"bar"}'), failure: null });
		expect(result.tokens).toBeUndefined();
		expect(result.error).toMatchObject({
			source: 'token',
			error: 'invalid_response',
			detail: '{"foo":"bar"}'
		});
	});

	it('REQ-FLOW-010 non-2xx JSON with error becomes a token RunError with all fields', () => {
		const result = parseTokenResponse({
			final: exchange(
				400,
				JSON.stringify({
					error: 'invalid_grant',
					error_description: 'Code expired',
					error_uri: 'https://idp.test/docs/invalid_grant'
				})
			),
			failure: null
		});
		expect(result.tokens).toBeUndefined();
		expect(result.error).toEqual({
			source: 'token',
			error: 'invalid_grant',
			error_description: 'Code expired',
			error_uri: 'https://idp.test/docs/invalid_grant',
			httpStatus: 400
		});
	});

	it('REQ-FLOW-010 a TLS failure becomes source tls, other failures source network', () => {
		const tls = parseTokenResponse({ final: null, failure: failure('tls', 'bad cert') });
		expect(tls.error).toEqual({ source: 'tls', error: 'tls', detail: 'bad cert' });
		const timeout = parseTokenResponse({ final: null, failure: failure('timeout', 'timed out') });
		expect(timeout.error).toEqual({ source: 'network', error: 'timeout', detail: 'timed out' });
	});

	it('REQ-FLOW-011 a non-JSON body gives invalid_response with the first 2 KB as detail', () => {
		const body = '<html>' + 'x'.repeat(5000);
		const result = parseTokenResponse({ final: exchange(502, body, 'text/html'), failure: null });
		expect(result.error).toMatchObject({
			source: 'token',
			error: 'invalid_response',
			httpStatus: 502
		});
		expect(result.error?.detail).toBe(body.slice(0, 2048));
		const ok = parseTokenResponse({
			final: exchange(200, 'not json', 'text/plain'),
			failure: null
		});
		expect(ok.error).toMatchObject({ error: 'invalid_response', detail: 'not json' });
	});

	it('REQ-FLOW-011 a JSON error-less non-2xx body is also an invalid_response', () => {
		const result = parseTokenResponse({
			final: exchange(500, '{"message":"boom"}'),
			failure: null
		});
		expect(result.error).toMatchObject({
			source: 'token',
			error: 'invalid_response',
			httpStatus: 500,
			detail: '{"message":"boom"}'
		});
	});
});
