import type { Header, HttpExchange, NavigationRecord } from '#lib/ipc/types.js';
import type { Run } from '#lib/model/run.js';

export interface HarNameValue {
	name: string;
	value: string;
}

export interface HarEntry {
	startedDateTime: string;
	time: number;
	request: {
		method: string;
		url: string;
		httpVersion: string;
		cookies: [];
		headers: HarNameValue[];
		queryString: HarNameValue[];
		postData?: { mimeType: string; text: string };
		headersSize: -1;
		bodySize: number;
	};
	response: {
		status: number;
		statusText: string;
		httpVersion: string;
		cookies: [];
		headers: HarNameValue[];
		content: { size: number; mimeType: string; text: string; encoding?: 'base64' };
		redirectURL: string;
		headersSize: -1;
		bodySize: number;
	};
	cache: Record<string, never>;
	timings: { send: number; wait: number; receive: number };
}

export interface Har {
	log: {
		version: '1.2';
		creator: { name: string; version: string };
		pages: [];
		entries: HarEntry[];
		_navigations: NavigationRecord[];
	};
}

function headerValue(headers: Header[], name: string): string | undefined {
	const lower = name.toLowerCase();
	return headers.find(([key]) => key.toLowerCase() === lower)?.[1];
}

function toNameValues(pairs: Iterable<[string, string]>): HarNameValue[] {
	return Array.from(pairs, ([name, value]) => ({ name, value }));
}

function queryString(url: string): HarNameValue[] {
	try {
		return toNameValues(new URL(url).searchParams.entries());
	} catch {
		return [];
	}
}

/** Decoded byte length of a base64 string. */
function base64Size(base64: string): number {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return Math.floor((base64.length * 3) / 4) - padding;
}

function toEntry({ request, response, startedAt, durationMs }: HttpExchange): HarEntry {
	const requestBody = request.body ?? '';
	const requestBytes = new TextEncoder().encode(requestBody).length;
	const responseSize = response.bodyBase64
		? base64Size(response.bodyBase64)
		: new TextEncoder().encode(response.body).length;
	const content: HarEntry['response']['content'] = {
		size: responseSize,
		mimeType: headerValue(response.headers, 'content-type') ?? 'x-unknown',
		text: response.bodyBase64 ?? response.body
	};
	if (response.bodyBase64) content.encoding = 'base64';

	const entry: HarEntry = {
		startedDateTime: startedAt,
		time: durationMs,
		request: {
			method: request.method,
			url: request.url,
			httpVersion: response.httpVersion,
			cookies: [],
			headers: toNameValues(request.headers),
			queryString: queryString(request.url),
			headersSize: -1,
			bodySize: requestBytes
		},
		response: {
			status: response.status,
			statusText: response.statusText,
			httpVersion: response.httpVersion,
			cookies: [],
			headers: toNameValues(response.headers),
			content,
			redirectURL: headerValue(response.headers, 'location') ?? '',
			headersSize: -1,
			bodySize: responseSize
		},
		cache: {},
		timings: { send: 0, wait: durationMs, receive: 0 }
	};
	if (request.body !== null && request.body !== '') {
		entry.request.postData = {
			mimeType: headerValue(request.headers, 'content-type') ?? 'text/plain',
			text: request.body
		};
	}
	return entry;
}

/** REQ-TL-004: HAR 1.2 document for a run, one entry per HTTP exchange. */
export function toHar(run: Run, appVersion: string): Har {
	return {
		log: {
			version: '1.2',
			creator: { name: 'OIDC Tester', version: appVersion },
			pages: [],
			entries: run.exchanges.map(toEntry),
			_navigations: run.navigations
		}
	};
}
