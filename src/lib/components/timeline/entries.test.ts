import { describe, expect, it } from 'vitest';
import type { HttpExchange } from '#lib/ipc/types.js';
import type { Run } from '#lib/model/run.js';
import { buildTimeline, filterEntries, formatBody } from './entries';

function exchange(id: string, startedAt: string): HttpExchange {
	return {
		id,
		startedAt,
		durationMs: 5,
		request: { method: 'GET', url: `https://idp.test/${id}`, headers: [], body: null },
		response: {
			status: 200,
			statusText: 'OK',
			httpVersion: 'HTTP/1.1',
			headers: [],
			body: '',
			bodyBase64: null
		}
	};
}

function run(): Run {
	return {
		navigations: [
			{ url: 'https://idp.test/authorize', at: '2026-01-01T10:00:01.000Z' },
			{ url: 'http://spoofed.invalid/cb', at: '2026-01-01T10:00:03.000Z' }
		],
		exchanges: [
			exchange('disc', '2026-01-01T10:00:00.000Z'),
			exchange('token', '2026-01-01T10:00:04.000Z')
		]
	} as Run;
}

describe('timeline entries', () => {
	it('REQ-TL-001 merges navigations and exchanges chronologically', () => {
		const entries = buildTimeline(run());
		expect(
			entries.map((e) => (e.type === 'nav' ? `nav:${e.url}` : `http:${e.exchange.id}`))
		).toEqual([
			'http:disc',
			'nav:https://idp.test/authorize',
			'nav:http://spoofed.invalid/cb',
			'http:token'
		]);
	});

	it('REQ-TL-001 keeps navigations before exchanges on equal timestamps', () => {
		const r = {
			navigations: [{ url: 'u', at: '2026-01-01T00:00:00Z' }],
			exchanges: [exchange('a', '2026-01-01T00:00:00Z')]
		} as Run;
		expect(buildTimeline(r).map((e) => e.type)).toEqual(['nav', 'http']);
	});

	it('REQ-TL-001 filters by type', () => {
		const entries = buildTimeline(run());
		expect(filterEntries(entries, 'nav')).toHaveLength(2);
		expect(filterEntries(entries, 'http')).toHaveLength(2);
		expect(filterEntries(entries, 'all')).toHaveLength(4);
	});

	it('REQ-TL-002 pretty-prints JSON bodies', () => {
		expect(formatBody('{"a":1}', [['Content-Type', 'application/json']])).toEqual({
			kind: 'json',
			text: '{\n  "a": 1\n}'
		});
	});

	it('REQ-TL-002 turns form bodies into name/value rows', () => {
		expect(
			formatBody('grant_type=code&redirect_uri=http%3A%2F%2Fx%2Fcb', [
				['content-type', 'application/x-www-form-urlencoded']
			])
		).toEqual({
			kind: 'form',
			rows: [
				{ name: 'grant_type', value: 'code' },
				{ name: 'redirect_uri', value: 'http://x/cb' }
			]
		});
	});

	it('REQ-TL-002 falls back to text and empty', () => {
		expect(formatBody('hello', [])).toEqual({ kind: 'text', text: 'hello' });
		expect(formatBody(null, [])).toEqual({ kind: 'empty' });
		expect(formatBody('{bad', [['Content-Type', 'application/json']])).toEqual({
			kind: 'text',
			text: '{bad'
		});
	});
});
