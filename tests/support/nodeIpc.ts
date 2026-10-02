/**
 * Node implementation of the host `IpcApi` (src/lib/ipc/types.ts) for integration tests.
 *
 * - httpSend: undici, never follows redirects, preserves header order, maps errors to HttpFailure kinds.
 * - authWindowOpen: simulates the popup. It GETs the URL (cookie jar per window), follows redirects and
 *   resolves `captured` as soon as a visited URL matches `redirectUri` (same rule as Rust
 *   `matches_redirect`). A non-redirect final page resolves `closed`, except when `redirectUri` is null
 *   (device flow): the page is loaded and the promise resolves `closed` on authWindowClose(). If
 *   `options.login` is set and the page is an HTML login form, the form is submitted with those credentials.
 * - secrets / docs: in-memory (docs validate paths like Rust storage.rs and round-trip through JSON).
 * - files: written/read under a temp dir (relative paths resolve there); `dispose()` removes it.
 * Everything observable is exposed on `ipc.state`.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { STATUS_CODES } from 'node:http';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { Agent, EnvHttpProxyAgent, ProxyAgent, request } from 'undici';
import type { Dispatcher } from 'undici';
import type {
	AuthWindowArgs,
	AuthWindowResult,
	FileDialogFilter,
	Header,
	HttpFailure,
	HttpFailureKind,
	HttpRequestSpec,
	HttpResult,
	IpcApi,
	NavigationRecord,
	RecordedRequest
} from '../../src/lib/ipc/types.ts';

export type DialogAnswer<A> = string | null | ((opts: A) => string | null);

export interface NodeIpcOptions {
	/** Credentials typed into an HTML login form shown by the simulated popup. */
	login?: { username: string; password: string } | null;
	/** Answer of pickSavePath. Default: <tempDir>/<basename(defaultPath)>. */
	pickSavePath?: DialogAnswer<{ defaultPath?: string; filters?: FileDialogFilter[] }>;
	/** Answer of pickOpenPath. Default: null (cancelled). */
	pickOpenPath?: DialogAnswer<{ filters?: FileDialogFilter[] }>;
	/** Popup accepts self-signed certificates (default true; the popup is not the transport under test). */
	popupTlsInsecure?: boolean;
	/** Max redirects the simulated popup follows (default 15). */
	maxPopupHops?: number;
}

interface BrowseResult {
	status: number;
	location: string | null;
	page: string;
}

export interface NodeIpcState {
	secrets: Map<string, string>;
	/** Normalized path -> JSON value. */
	docs: Map<string, unknown>;
	/** Every httpSend outcome in order. */
	http: HttpResult[];
	authWindowOpens: AuthWindowArgs[];
	authWindowCloses: number;
	browserSessionClears: number;
	openedUrls: string[];
	/** Cookie jar of persistent (non-clean) popup sessions: hostname -> name -> value. */
	cookies: Map<string, Map<string, string>>;
	tempDir: string;
}

export interface NodeIpc extends IpcApi {
	state: NodeIpcState;
	options: NodeIpcOptions;
	/** Successful exchanges / failures recorded so far. */
	exchanges(): Extract<HttpResult, { ok: true }>['exchange'][];
	failures(): HttpFailure[];
	dispose(): Promise<void>;
}

/** Same rule as Rust `matches_redirect`: scheme, host (case-insensitive), port (default-normalized), path. */
export function matchesRedirect(visited: string, redirectUri: string): boolean {
	let a: URL;
	let b: URL;
	try {
		a = new URL(visited);
		b = new URL(redirectUri);
	} catch {
		return false;
	}
	return (
		a.protocol === b.protocol &&
		a.hostname.toLowerCase() === b.hostname.toLowerCase() &&
		a.port === b.port &&
		a.pathname === b.pathname
	);
}

function validatePath(path: string): string {
	const bad =
		path.length === 0 ||
		path.split('/').some((s) => s === '' || s === '.' || s === '..' || /[\\:\0]/.test(s));
	if (bad) throw new Error('invalid path');
	return path;
}

function errorChain(err: unknown): { codes: string[]; messages: string[] } {
	const codes: string[] = [];
	const messages: string[] = [];
	const seen = new Set<unknown>();
	const visit = (e: unknown): void => {
		if (!e || typeof e !== 'object' || seen.has(e)) return;
		seen.add(e);
		const x = e as {
			code?: unknown;
			message?: unknown;
			cause?: unknown;
			errors?: unknown;
			name?: unknown;
		};
		if (typeof x.code === 'string') codes.push(x.code);
		if (typeof x.name === 'string') codes.push(x.name);
		if (typeof x.message === 'string') messages.push(x.message);
		visit(x.cause);
		if (Array.isArray(x.errors)) x.errors.forEach(visit);
	};
	visit(err);
	return { codes, messages };
}

const TLS_CODES = new Set([
	'DEPTH_ZERO_SELF_SIGNED_CERT',
	'SELF_SIGNED_CERT_IN_CHAIN',
	'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
	'UNABLE_TO_GET_ISSUER_CERT',
	'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
	'CERT_HAS_EXPIRED',
	'CERT_NOT_YET_VALID',
	'CERT_UNTRUSTED',
	'ERR_TLS_CERT_ALTNAME_INVALID',
	'HOSTNAME_MISMATCH'
]);
const CONNECT_CODES = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'EADDRNOTAVAIL',
	'EPIPE',
	'UND_ERR_SOCKET',
	'UND_ERR_CLOSED'
]);
const TIMEOUT_CODES = new Set([
	'UND_ERR_HEADERS_TIMEOUT',
	'UND_ERR_BODY_TIMEOUT',
	'UND_ERR_CONNECT_TIMEOUT',
	'ETIMEDOUT',
	'TimeoutError',
	'AbortError'
]);

function classifyError(err: unknown, spec: HttpRequestSpec): HttpFailureKind {
	const { codes, messages } = errorChain(err);
	const has = (set: Set<string>) => codes.some((c) => set.has(c));
	if (codes.includes('UND_ERR_INVALID_ARG') || codes.includes('InvalidArgumentError')) {
		return 'invalidRequest';
	}
	if (codes.some((c) => c.startsWith('UND_ERR_PRX')) || messages.some((m) => /proxy/i.test(m))) {
		return 'proxy';
	}
	if (
		has(TLS_CODES) ||
		codes.some((c) => c.startsWith('ERR_SSL')) ||
		messages.some((m) => /certificate/i.test(m))
	) {
		return 'tls';
	}
	if (has(TIMEOUT_CODES)) return 'timeout';
	if (codes.some((c) => c === 'ENOTFOUND' || c === 'EAI_AGAIN' || c === 'EAI_NODATA')) return 'dns';
	if (has(CONNECT_CODES)) return spec.proxy.mode === 'url' ? 'proxy' : 'connect';
	return 'other';
}

function makeDispatcher(spec: HttpRequestSpec): Dispatcher {
	const tls = { rejectUnauthorized: !spec.tlsInsecure };
	const timeouts = {
		connectTimeout: spec.timeoutMs,
		headersTimeout: spec.timeoutMs,
		bodyTimeout: spec.timeoutMs
	};
	if (spec.proxy.mode === 'url' && spec.proxy.url) {
		return new ProxyAgent({ uri: spec.proxy.url, requestTls: tls, proxyTls: tls, ...timeouts });
	}
	if (spec.proxy.mode === 'system') return new EnvHttpProxyAgent({ connect: tls, ...timeouts });
	return new Agent({ connect: tls, ...timeouts });
}

function flattenHeaders(raw: Record<string, string | string[] | undefined>): Header[] {
	const out: Header[] = [];
	for (const [name, value] of Object.entries(raw)) {
		if (value === undefined) continue;
		for (const v of Array.isArray(value) ? value : [value]) out.push([name, v]);
	}
	return out;
}

async function sendHttp(spec: HttpRequestSpec): Promise<HttpResult> {
	const recorded: RecordedRequest = {
		method: spec.method,
		url: spec.url,
		headers: spec.headers,
		body: spec.body
	};
	const failure = (kind: HttpFailureKind, message: string): HttpResult => ({
		ok: false,
		failure: { kind, message, request: recorded }
	});
	let target: URL;
	try {
		target = new URL(spec.url);
	} catch {
		return failure('invalidRequest', `invalid URL: ${spec.url}`);
	}
	if (target.protocol !== 'http:' && target.protocol !== 'https:') {
		return failure('invalidRequest', `unsupported URL scheme: ${target.protocol}`);
	}
	const startedAt = new Date();
	const t0 = performance.now();
	const dispatcher = makeDispatcher(spec);
	try {
		const res = await request(spec.url, {
			method: spec.method as Dispatcher.HttpMethod,
			headers: spec.headers.flat(),
			body: spec.body ?? undefined,
			dispatcher,
			signal: AbortSignal.timeout(spec.timeoutMs)
		});
		const bytes = Buffer.from(await res.body.arrayBuffer());
		let text = '';
		let base64: string | null = null;
		try {
			text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		} catch {
			base64 = bytes.toString('base64');
		}
		return {
			ok: true,
			exchange: {
				id: randomUUID(),
				startedAt: startedAt.toISOString(),
				durationMs: Math.round(performance.now() - t0),
				request: recorded,
				response: {
					status: res.statusCode,
					statusText: STATUS_CODES[res.statusCode] ?? '',
					httpVersion: 'HTTP/1.1',
					headers: flattenHeaders(res.headers),
					body: text,
					bodyBase64: base64
				}
			}
		};
	} catch (err) {
		const message = errorChain(err).messages.join(': ') || String(err);
		return failure(classifyError(err, spec), message);
	} finally {
		await dispatcher.close().catch(() => undefined);
	}
}

// ---------------------------------------------------------------- popup simulation

function attr(tag: string, name: string): string | null {
	const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
	return m ? (m[2] ?? m[3] ?? '') : null;
}

function unescapeHtml(s: string): string {
	return s
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&amp;', '&');
}

/** Builds the POST request that submitting the first HTML form on the page would send. */
function buildFormSubmission(
	page: string,
	base: string,
	login: { username: string; password: string }
): { url: string; body: string } | null {
	const form = /<form\b([^>]*)>([\s\S]*?)<\/form>/i.exec(page);
	if (!form) return null;
	const action = attr(form[1], 'action') ?? '';
	const fields = new URLSearchParams();
	let submitSet = false;
	for (const tag of form[2].match(/<(input|button)\b[^>]*>/gi) ?? []) {
		const name = attr(tag, 'name');
		if (!name) continue;
		const type = (attr(tag, 'type') ?? 'text').toLowerCase();
		const value = unescapeHtml(attr(tag, 'value') ?? '');
		if (/^<button/i.test(tag) || type === 'submit') {
			if (!submitSet) {
				fields.set(name, value);
				submitSet = true;
			}
			continue;
		}
		fields.set(name, value);
	}
	if (fields.has('username')) {
		fields.set('username', login.username);
		fields.set('password', login.password);
	}
	return { url: new URL(unescapeHtml(action), base).href, body: fields.toString() };
}

function storeCookies(
	jar: Map<string, Map<string, string>>,
	host: string,
	setCookie: string | string[] | undefined
): void {
	for (const line of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
		const [pair, ...attrs] = line.split(';');
		const i = pair.indexOf('=');
		if (i <= 0) continue;
		const name = pair.slice(0, i).trim();
		const value = pair.slice(i + 1).trim();
		const hostJar = jar.get(host) ?? new Map<string, string>();
		jar.set(host, hostJar);
		const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '';
		if (expired) hostJar.delete(name);
		else hostJar.set(name, value);
	}
}

export function createNodeIpc(options: NodeIpcOptions = {}): NodeIpc {
	const tempDir = mkdtempSync(join(tmpdir(), 'oidct-ipc-'));
	const state: NodeIpcState = {
		secrets: new Map(),
		docs: new Map(),
		http: [],
		authWindowOpens: [],
		authWindowCloses: 0,
		browserSessionClears: 0,
		openedUrls: [],
		cookies: new Map(),
		tempDir
	};
	const closers = new Set<() => void>();

	const resolveFile = (p: string): string => (isAbsolute(p) ? p : resolve(tempDir, p));
	const answer = <A>(
		a: DialogAnswer<A> | undefined,
		arg: A,
		fallback: string | null
	): string | null => (a === undefined ? fallback : typeof a === 'function' ? a(arg) : a);

	async function browse(
		url: string,
		method: 'GET' | 'POST',
		body: string | null,
		jar: Map<string, Map<string, string>>
	): Promise<BrowseResult> {
		const target = new URL(url);
		target.hash = '';
		const cookie = [...(jar.get(target.hostname) ?? [])].map(([k, v]) => `${k}=${v}`).join('; ');
		const headers: Record<string, string> = { accept: 'text/html,*/*' };
		if (cookie) headers.cookie = cookie;
		if (body !== null) headers['content-type'] = 'application/x-www-form-urlencoded';
		const agent = new Agent({
			connect: { rejectUnauthorized: options.popupTlsInsecure === false }
		});
		try {
			const res = await request(target.href, {
				method,
				headers,
				body: body ?? undefined,
				dispatcher: agent
			});
			storeCookies(jar, target.hostname, res.headers['set-cookie']);
			const page = await res.body.text();
			const loc = res.headers.location;
			return {
				status: res.statusCode,
				location: typeof loc === 'string' ? new URL(loc, target).href : null,
				page
			};
		} finally {
			await agent.close().catch(() => undefined);
		}
	}

	const ipc: NodeIpc = {
		state,
		options,
		exchanges: () => state.http.flatMap((r) => (r.ok ? [r.exchange] : [])),
		failures: () => state.http.flatMap((r) => (r.ok ? [] : [r.failure])),

		async httpSend(spec) {
			const result = await sendHttp(spec);
			state.http.push(result);
			return result;
		},

		async authWindowOpen(args): Promise<AuthWindowResult> {
			state.authWindowOpens.push(args);
			const navigations: NavigationRecord[] = [];
			const visit = (url: string) => navigations.push({ url, at: new Date().toISOString() });
			const jar = args.cleanSession ? new Map<string, Map<string, string>>() : state.cookies;
			const closedByUser = Promise.withResolvers<void>();
			closers.add(closedByUser.resolve);
			const userClosed = closedByUser.promise.then((): AuthWindowResult => ({
				kind: 'closed',
				navigations
			}));
			try {
				const walk = async (): Promise<AuthWindowResult> => {
					let url = args.url;
					let method: 'GET' | 'POST' = 'GET';
					let body: string | null = null;
					for (let hop = 0; hop < (options.maxPopupHops ?? 15); hop++) {
						visit(url);
						if (args.redirectUri !== null && matchesRedirect(url, args.redirectUri)) {
							return { kind: 'captured', url, navigations };
						}
						const res: BrowseResult = await browse(url, method, body, jar).catch(() => ({
							status: 0,
							location: null,
							page: ''
						}));
						method = 'GET';
						body = null;
						if (res.location) {
							url = res.location;
							continue;
						}
						const submission =
							options.login && res.status < 400
								? buildFormSubmission(res.page, url, options.login)
								: null;
						if (submission && args.redirectUri !== null) {
							url = submission.url;
							method = 'POST';
							body = submission.body;
							continue;
						}
						break;
					}
					if (args.redirectUri === null) return userClosed; // stays open until authWindowClose()
					return { kind: 'closed', navigations };
				};
				return await Promise.race([walk(), userClosed]);
			} finally {
				closers.delete(closedByUser.resolve);
			}
		},

		async authWindowClose() {
			state.authWindowCloses++;
			for (const close of [...closers]) close();
		},

		async browserClearSession() {
			state.browserSessionClears++;
			state.cookies.clear();
		},

		async secretSet(key, value) {
			state.secrets.set(key, value);
		},
		async secretGet(key) {
			return state.secrets.get(key) ?? null;
		},
		async secretDelete(key) {
			state.secrets.delete(key);
		},

		async docRead(path) {
			const key = validatePath(path);
			return state.docs.has(key) ? structuredClone(state.docs.get(key)) : null;
		},
		async docWrite(path, value) {
			state.docs.set(validatePath(path), JSON.parse(JSON.stringify(value)) as unknown);
		},
		async docList(dir) {
			const prefix = `${validatePath(dir)}/`;
			const names = new Set<string>();
			for (const key of state.docs.keys()) {
				if (!key.startsWith(prefix)) continue;
				const rest = key.slice(prefix.length);
				const slash = rest.indexOf('/');
				if (slash >= 0) names.add(rest.slice(0, slash));
				else if (rest.endsWith('.json')) names.add(rest.slice(0, -'.json'.length));
			}
			return [...names].sort();
		},
		async docDelete(path) {
			const key = validatePath(path);
			for (const k of [...state.docs.keys()]) {
				if (k === key || k.startsWith(`${key}/`)) state.docs.delete(k);
			}
		},

		async writeTextFile(path, contents) {
			const file = resolveFile(path);
			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, contents, 'utf8');
		},
		async readTextFile(path) {
			return readFile(resolveFile(path), 'utf8');
		},

		async openUrl(url) {
			state.openedUrls.push(url);
		},
		async pickSavePath(opts) {
			const fallback = join(tempDir, basename(opts.defaultPath ?? 'export.txt'));
			return answer(options.pickSavePath, opts, fallback);
		},
		async pickOpenPath(opts) {
			return answer(options.pickOpenPath, opts, null);
		},

		async dispose() {
			for (const close of [...closers]) close();
			await rm(tempDir, { recursive: true, force: true });
		}
	};
	return ipc;
}
