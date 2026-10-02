import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import type { HttpFailure, HttpExchange, HttpResult, IpcApi } from './types';

function isHttpFailure(e: unknown): e is HttpFailure {
	return typeof e === 'object' && e !== null && 'kind' in e && 'message' in e && 'request' in e;
}

/** The single place that calls Tauri `invoke`. UI and logic code depend on `IpcApi`. */
export const ipc: IpcApi = {
	async httpSend(req): Promise<HttpResult> {
		try {
			const exchange = await invoke<HttpExchange>('http_send', { req });
			return { ok: true, exchange };
		} catch (e) {
			if (isHttpFailure(e)) return { ok: false, failure: e };
			throw e;
		}
	},
	authWindowOpen: (args) => invoke('auth_window_open', { args }),
	authWindowClose: () => invoke('auth_window_close'),
	browserClearSession: () => invoke('browser_clear_session'),
	secretSet: (key, value) => invoke('secret_set', { key, value }),
	secretGet: (key) => invoke('secret_get', { key }),
	secretDelete: (key) => invoke('secret_delete', { key }),
	docRead: (path) => invoke('doc_read', { path }),
	docWrite: (path, value) => invoke('doc_write', { path, value }),
	docList: (dir) => invoke('doc_list', { dir }),
	docDelete: (path) => invoke('doc_delete', { path }),
	writeTextFile: (path, contents) => invoke('write_text_file', { path, contents }),
	readTextFile: (path) => invoke('read_text_file', { path }),
	openUrl: (url) => openUrl(url),
	pickSavePath: (opts) => saveDialog(opts),
	pickOpenPath: async (opts) => {
		const picked = await openDialog({ multiple: false, directory: false, ...opts });
		return typeof picked === 'string' ? picked : null;
	}
};
