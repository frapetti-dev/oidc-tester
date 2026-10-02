import { describe, expect, it } from 'vitest';
import type { HttpExchange } from '$lib/ipc/types';
import { toCurl } from './curl';

function exchange(overrides: Partial<HttpExchange['request']> = {}): HttpExchange {
	return {
		id: 'x1',
		startedAt: '2026-10-02T12:00:00Z',
		durationMs: 12,
		request: {
			method: 'POST',
			url: 'https://idp.example/token',
			headers: [
				['Content-Type', 'application/x-www-form-urlencoded'],
				['Accept', 'application/json'],
				['X-Dup', 'one'],
				['X-Dup', 'two']
			],
			body: 'grant_type=client_credentials&client_id=abc',
			...overrides
		},
		response: {
			status: 200,
			statusText: 'OK',
			httpVersion: 'HTTP/1.1',
			headers: [],
			body: '{}',
			bodyBase64: null
		}
	};
}

const plain = { tlsInsecure: false, proxy: { mode: 'system' as const, url: '' } };

describe('toCurl', () => {
	it('REQ-TL-003 emits -X METHOD, one -H per header in order and --data-raw for the body', () => {
		const cmd = toCurl(exchange(), plain);
		expect(cmd).toBe(
			"curl -X POST 'https://idp.example/token'" +
				" -H 'Content-Type: application/x-www-form-urlencoded'" +
				" -H 'Accept: application/json'" +
				" -H 'X-Dup: one'" +
				" -H 'X-Dup: two'" +
				" --data-raw 'grant_type=client_credentials&client_id=abc'"
		);
	});

	it("REQ-TL-003 escapes single quotes as '\\'' in url, headers and body", () => {
		const cmd = toCurl(
			exchange({
				url: "https://idp.example/a'b",
				headers: [['X-Name', "o'brien"]],
				body: "it's"
			}),
			plain
		);
		expect(cmd).toContain("'https://idp.example/a'\\''b'");
		expect(cmd).toContain("-H 'X-Name: o'\\''brien'");
		expect(cmd).toContain("--data-raw 'it'\\''s'");
	});

	it('REQ-TL-003 omits --data-raw when there is no body and keeps -X for GET', () => {
		const cmd = toCurl(exchange({ method: 'GET', body: null, headers: [] }), plain);
		expect(cmd).toBe("curl -X GET 'https://idp.example/token'");
	});

	it('REQ-TL-003 adds -k when tlsInsecure is set', () => {
		const cmd = toCurl(exchange({ body: null, headers: [] }), { ...plain, tlsInsecure: true });
		expect(cmd.split(' ')).toContain('-k');
		expect(toCurl(exchange(), plain).split(' ')).not.toContain('-k');
	});

	it('REQ-TL-003 adds -x <url> for proxy mode url and --noproxy for mode none', () => {
		const viaProxy = toCurl(exchange({ body: null, headers: [] }), {
			tlsInsecure: false,
			proxy: { mode: 'url', url: 'http://proxy.local:3128' }
		});
		expect(viaProxy).toContain(" -x 'http://proxy.local:3128'");
		expect(viaProxy).not.toContain('--noproxy');

		const direct = toCurl(exchange({ body: null, headers: [] }), {
			tlsInsecure: false,
			proxy: { mode: 'none', url: '' }
		});
		expect(direct).toContain(" --noproxy '*'");
		expect(direct).not.toContain(' -x ');

		const system = toCurl(exchange({ body: null, headers: [] }), plain);
		expect(system).not.toContain('--noproxy');
		expect(system).not.toContain(' -x ');
	});
});
