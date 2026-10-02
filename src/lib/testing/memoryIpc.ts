import type {
	AuthWindowArgs,
	AuthWindowResult,
	FileDialogFilter,
	HttpRequestSpec,
	HttpResult,
	IpcApi
} from '$lib/ipc/types';

export interface MemoryIpc extends IpcApi {
	docs: Map<string, unknown>;
	secrets: Map<string, string>;
	files: Map<string, string>;
	opened: string[];
	calls: string[];
	/** Make the next `secretSet` reject with this message. */
	failSecretSet: string | null;
	/** Next paths returned by the dialogs (null = cancelled). */
	savePath: string | null;
	openPath: string | null;
	onHttpSend: (req: HttpRequestSpec) => Promise<HttpResult>;
	onAuthWindowOpen: (args: AuthWindowArgs) => Promise<AuthWindowResult>;
}

function assertValidPath(path: string) {
	const bad =
		path === '' ||
		path.startsWith('/') ||
		path.includes('\\') ||
		path.split('/').some((s) => s === '' || s === '..' || s.includes(':'));
	if (bad) throw 'invalid path';
}

/**
 * In-memory IpcApi for unit/component tests: documents, secrets and files are Maps with the same
 * path validation as the Rust storage module; transport calls are programmable per test.
 */
export function createMemoryIpc(): MemoryIpc {
	const ipc: MemoryIpc = {
		docs: new Map(),
		secrets: new Map(),
		files: new Map(),
		opened: [],
		calls: [],
		failSecretSet: null,
		savePath: null,
		openPath: null,
		onHttpSend: async () => {
			throw new Error('httpSend not programmed');
		},
		onAuthWindowOpen: async () => {
			throw new Error('authWindowOpen not programmed');
		},
		httpSend: (req) => ipc.onHttpSend(req),
		authWindowOpen: (args) => ipc.onAuthWindowOpen(args),
		authWindowClose: async () => {
			ipc.calls.push('authWindowClose');
		},
		browserClearSession: async () => {
			ipc.calls.push('browserClearSession');
		},
		secretSet: async (key, value) => {
			if (ipc.failSecretSet !== null) throw ipc.failSecretSet;
			ipc.secrets.set(key, value);
		},
		secretGet: async (key) => ipc.secrets.get(key) ?? null,
		secretDelete: async (key) => {
			ipc.secrets.delete(key);
		},
		docRead: async (path) => {
			assertValidPath(path);
			return structuredClone(ipc.docs.get(path) ?? null);
		},
		docWrite: async (path, value) => {
			assertValidPath(path);
			ipc.docs.set(path, structuredClone(value));
		},
		docList: async (dir) => {
			assertValidPath(dir);
			const prefix = `${dir}/`;
			const names = new Set<string>();
			for (const key of ipc.docs.keys()) {
				if (!key.startsWith(prefix)) continue;
				const rest = key.slice(prefix.length);
				const slash = rest.indexOf('/');
				if (slash >= 0) names.add(rest.slice(0, slash));
				else if (rest.endsWith('.json')) names.add(rest.slice(0, -'.json'.length));
			}
			return [...names].sort();
		},
		docDelete: async (path) => {
			assertValidPath(path);
			for (const key of [...ipc.docs.keys()]) {
				if (key === path || key.startsWith(`${path}/`)) ipc.docs.delete(key);
			}
		},
		writeTextFile: async (path, contents) => {
			ipc.files.set(path, contents);
		},
		readTextFile: async (path) => {
			const text = ipc.files.get(path);
			if (text === undefined) throw `file not found: ${path}`;
			return text;
		},
		openUrl: async (url) => {
			ipc.opened.push(url);
		},
		pickSavePath: async (_opts: { defaultPath?: string; filters?: FileDialogFilter[] }) =>
			ipc.savePath,
		pickOpenPath: async (_opts: { filters?: FileDialogFilter[] }) => ipc.openPath
	};
	return ipc;
}
