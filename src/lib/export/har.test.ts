import { describe, expect, it } from 'vitest';
import type { Run } from '#lib/model/run.js';
import { newFlow, newIdp } from '#lib/model/schema.js';
import { toHar } from './har';

function makeRun(): Run {
	const idp = newIdp('Mock');
	const flow = newFlow('client_credentials');
	return {
		id: 'run-1',
		workspaceId: 'scratchpad',
		idpId: idp.id,
		clientId: 'client-1',
		flowId: flow.id,
		flowSnapshot: flow,
		idpSnapshot: idp,
		startedAt: '2026-10-02T12:00:00.000Z',
		finishedAt: '2026-10-02T12:00:02.000Z',
		status: 'success',
		navigations: [
			{ url: 'https://idp.example/authorize?x=1', at: '2026-10-02T12:00:00.500Z' },
			{ url: 'http://spoofed.invalid/cb?code=abc', at: '2026-10-02T12:00:01.000Z' }
		],
		exchanges: [
			{
				id: 'e1',
				startedAt: '2026-10-02T12:00:01.100Z',
				durationMs: 42,
				request: {
					method: 'POST',
					url: 'https://idp.example/token?tenant=a&tenant=b&x=%20y',
					headers: [
						['Content-Type', 'application/x-www-form-urlencoded'],
						['Authorization', 'Basic YTpi']
					],
					body: 'grant_type=client_credentials'
				},
				response: {
					status: 200,
					statusText: 'OK',
					httpVersion: 'HTTP/1.1',
					headers: [
						['content-type', 'application/json'],
						['set-cookie', 'a=b']
					],
					body: '{"access_token":"t"}',
					bodyBase64: null
				}
			},
			{
				id: 'e2',
				startedAt: '2026-10-02T12:00:01.500Z',
				durationMs: 7,
				request: { method: 'GET', url: 'https://idp.example/jwks', headers: [], body: null },
				response: {
					status: 302,
					statusText: 'Found',
					httpVersion: 'HTTP/2.0',
					headers: [['Location', 'https://idp.example/keys']],
					body: '',
					bodyBase64: 'AAECAw=='
				}
			}
		],
		failures: [],
		validations: []
	};
}

describe('toHar', () => {
	it('REQ-TL-004 produces a HAR 1.2 log with creator, empty pages and one entry per exchange', () => {
		const har = toHar(makeRun(), '0.0.1');
		expect(har.log.version).toBe('1.2');
		expect(har.log.creator).toEqual({ name: 'OIDC Tester', version: '0.0.1' });
		expect(har.log.pages).toEqual([]);
		expect(har.log.entries).toHaveLength(2);
		expect(har.log.entries.map((e) => e.startedDateTime)).toEqual([
			'2026-10-02T12:00:01.100Z',
			'2026-10-02T12:00:01.500Z'
		]);
	});

	it('REQ-TL-004 entries carry time, request with postData and response with text content', () => {
		const [entry] = toHar(makeRun(), '0.0.1').log.entries;
		expect(entry.time).toBe(42);
		expect(entry.timings).toMatchObject({ send: 0, wait: 42, receive: 0 });
		expect(entry.request).toMatchObject({
			method: 'POST',
			url: 'https://idp.example/token?tenant=a&tenant=b&x=%20y',
			httpVersion: 'HTTP/1.1',
			headers: [
				{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
				{ name: 'Authorization', value: 'Basic YTpi' }
			],
			queryString: [
				{ name: 'tenant', value: 'a' },
				{ name: 'tenant', value: 'b' },
				{ name: 'x', value: ' y' }
			],
			postData: {
				mimeType: 'application/x-www-form-urlencoded',
				text: 'grant_type=client_credentials'
			},
			bodySize: 29
		});
		expect(entry.response).toMatchObject({
			status: 200,
			statusText: 'OK',
			httpVersion: 'HTTP/1.1',
			content: { size: 20, mimeType: 'application/json', text: '{"access_token":"t"}' }
		});
		expect(entry.response.content).not.toHaveProperty('encoding');
	});

	it('REQ-TL-004 omits postData without a body and uses base64 encoding when bodyBase64 is set', () => {
		const [, entry] = toHar(makeRun(), '0.0.1').log.entries;
		expect(entry.request).not.toHaveProperty('postData');
		expect(entry.request.bodySize).toBe(0);
		expect(entry.response.content).toMatchObject({
			size: 4,
			text: 'AAECAw==',
			encoding: 'base64'
		});
		expect(entry.response.redirectURL).toBe('https://idp.example/keys');
		expect(entry.response.bodySize).toBe(4);
	});

	it('REQ-TL-004 navigations go into the custom _navigations field', () => {
		const run = makeRun();
		const har = toHar(run, '0.0.1');
		expect(har.log._navigations).toEqual(run.navigations);
	});

	it('REQ-TL-004 is JSON serializable and survives a round trip unchanged', () => {
		const har = toHar(makeRun(), '0.0.1');
		expect(JSON.parse(JSON.stringify(har))).toEqual(har);
	});
});
