// TS mirror of the Rust transport contract (src-tauri/src/*.rs). All Rust types are
// #[serde(rename_all = "camelCase")]. Keep both sides in sync.

export type ProxyMode = 'none' | 'system' | 'url';

export interface ProxySpec {
	mode: ProxyMode;
	url: string | null;
}

export type Header = [name: string, value: string];

export interface HttpRequestSpec {
	method: string;
	url: string;
	headers: Header[];
	body: string | null;
	tlsInsecure: boolean;
	proxy: ProxySpec;
	timeoutMs: number;
}

export interface RecordedRequest {
	method: string;
	url: string;
	headers: Header[];
	body: string | null;
}

export interface RecordedResponse {
	status: number;
	statusText: string;
	httpVersion: string;
	headers: Header[];
	/** UTF-8 text; empty when the payload is not valid UTF-8 (see bodyBase64). */
	body: string;
	bodyBase64: string | null;
}

export interface HttpExchange {
	id: string;
	/** RFC 3339 */
	startedAt: string;
	durationMs: number;
	request: RecordedRequest;
	response: RecordedResponse;
}

export type HttpFailureKind =
	'invalidRequest' | 'tls' | 'dns' | 'connect' | 'timeout' | 'proxy' | 'other';

export interface HttpFailure {
	kind: HttpFailureKind;
	message: string;
	request: RecordedRequest;
}

/** Result of `http_send`: Rust returns Ok(HttpExchange) or Err(HttpFailure). */
export type HttpResult = { ok: true; exchange: HttpExchange } | { ok: false; failure: HttpFailure };

export interface AuthWindowArgs {
	url: string;
	redirectUri: string | null;
	cleanSession: boolean;
	title: string;
}

export interface NavigationRecord {
	url: string;
	/** RFC 3339 */
	at: string;
}

export type AuthWindowResult =
	| { kind: 'captured'; url: string; navigations: NavigationRecord[] }
	| { kind: 'closed'; navigations: NavigationRecord[] };

export interface FileDialogFilter {
	name: string;
	extensions: string[];
}

/**
 * Everything the app needs from the host. The real implementation is `ipc` in commands.ts
 * (Tauri invoke + plugins). Tests and the web E2E harness provide their own.
 */
export interface IpcApi {
	httpSend(req: HttpRequestSpec): Promise<HttpResult>;
	authWindowOpen(args: AuthWindowArgs): Promise<AuthWindowResult>;
	authWindowClose(): Promise<void>;
	browserClearSession(): Promise<void>;
	secretSet(key: string, value: string): Promise<void>;
	secretGet(key: string): Promise<string | null>;
	secretDelete(key: string): Promise<void>;
	docRead(path: string): Promise<unknown | null>;
	docWrite(path: string, value: unknown): Promise<void>;
	docList(dir: string): Promise<string[]>;
	docDelete(path: string): Promise<void>;
	writeTextFile(path: string, contents: string): Promise<void>;
	readTextFile(path: string): Promise<string>;
	/** Opens a URL in the system browser (opener plugin). */
	openUrl(url: string): Promise<void>;
	/** Native save dialog; null when cancelled. */
	pickSavePath(opts: {
		defaultPath?: string;
		filters?: FileDialogFilter[];
	}): Promise<string | null>;
	/** Native open dialog; null when cancelled. */
	pickOpenPath(opts: { filters?: FileDialogFilter[] }): Promise<string | null>;
	/** Main-window chrome for the custom titlebar. */
	windowMinimize(): Promise<void>;
	windowToggleMaximize(): Promise<void>;
	windowClose(): Promise<void>;
	windowIsMaximized(): Promise<boolean>;
	/** Calls `listener` after every window resize; resolves to an unsubscribe function. */
	onWindowResized(listener: () => void): Promise<() => void>;
}
