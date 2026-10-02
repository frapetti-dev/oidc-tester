import type { Header, HttpExchange, HttpFailure, HttpRequestSpec, IpcApi } from '$lib/ipc/types';
import type { Flow, Idp, KV } from '$lib/model/schema';

export const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Every request/response of a run, in order. Passed through the back-channel helpers. */
export interface HttpLog {
	exchanges: HttpExchange[];
	failures: HttpFailure[];
}

export function newHttpLog(): HttpLog {
	return { exchanges: [], failures: [] };
}

export function headerValue(headers: Header[], name: string): string | undefined {
	const wanted = name.toLowerCase();
	return headers.find(([n]) => n.toLowerCase() === wanted)?.[1];
}

/**
 * IdP headers first; a flow header with the same name (case-insensitive) replaces the IdP one;
 * `Origin` from settings and protocol headers are added unless the user already set that name.
 * Disabled rows and blank names are ignored.
 */
export function mergeHeaders(parts: {
	idp: KV[];
	flow: KV[];
	protocol: Header[];
	origin: string;
}): Header[] {
	const usable = (rows: KV[]) => rows.filter((r) => r.enabled && r.name.trim() !== '');
	const flow = usable(parts.flow);
	const flowNames = new Set(flow.map((r) => r.name.trim().toLowerCase()));
	const merged: Header[] = [
		...usable(parts.idp)
			.filter((r) => !flowNames.has(r.name.trim().toLowerCase()))
			.map((r): Header => [r.name.trim(), r.value]),
		...flow.map((r): Header => [r.name.trim(), r.value])
	];
	const addUnlessSet = (name: string, value: string) => {
		if (headerValue(merged, name) === undefined) merged.push([name, value]);
	};
	if (parts.origin.trim() !== '') addUnlessSet('Origin', parts.origin.trim());
	for (const [name, value] of parts.protocol) addUnlessSet(name, value);
	return merged;
}

export interface BackChannelRequest {
	method: string;
	url: string;
	/** Headers the protocol needs (Content-Type, Accept, Authorization); user-set names win. */
	protocolHeaders?: Header[];
	body?: string | null;
}

/** Build the `http_send` payload for a back-channel call using the IdP's HTTP settings. */
export function buildRequestSpec(
	idp: Idp,
	flow: Flow | null,
	req: BackChannelRequest
): HttpRequestSpec {
	const { http } = idp;
	return {
		method: req.method,
		url: req.url,
		headers: mergeHeaders({
			idp: http.headers,
			flow: flow?.headers ?? [],
			protocol: req.protocolHeaders ?? [],
			origin: http.origin
		}),
		body: req.body ?? null,
		tlsInsecure: http.tlsInsecure,
		proxy: { mode: http.proxy.mode, url: http.proxy.mode === 'url' ? http.proxy.url : null },
		timeoutMs: http.timeoutMs
	};
}

export interface SendResult {
	/** Last response received (may be a redirect when the hop limit was hit). */
	final: HttpExchange | null;
	failure: HttpFailure | null;
	error?: string;
}

/**
 * Sends via `ipc.httpSend`, recording every hop in `log`. GET requests follow
 * 301/302/303/307/308 up to MAX_REDIRECTS hops; other methods are never redirected.
 */
export async function sendWithRedirects(
	ipc: IpcApi,
	spec: HttpRequestSpec,
	log: HttpLog
): Promise<SendResult> {
	let current = spec;
	let final: HttpExchange | null = null;
	for (let hop = 0; ; hop++) {
		const result = await ipc.httpSend(current);
		if (!result.ok) {
			log.failures.push(result.failure);
			return { final, failure: result.failure };
		}
		final = result.exchange;
		log.exchanges.push(final);
		const location = headerValue(final.response.headers, 'location');
		if (spec.method !== 'GET' || !REDIRECT_STATUSES.has(final.response.status) || !location) {
			return { final, failure: null };
		}
		if (hop >= MAX_REDIRECTS) {
			return { final, failure: null, error: `Too many redirects (more than ${MAX_REDIRECTS})` };
		}
		current = { ...current, url: new URL(location, current.url).href, body: null };
	}
}
