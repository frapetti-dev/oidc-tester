import type { AuthWindowArgs, FileDialogFilter, HttpRequestSpec } from '../../src/lib/ipc/types.ts';
import type { NodeIpc } from '../../tests/support/nodeIpc.ts';

export type E2eReply = { ok: true; value: unknown } | { ok: false; error: unknown };

type Args = Record<string, unknown>;

/** Runs one Tauri command against the Node IPC implementation. Failures are thrown. */
async function run(ipc: NodeIpc, cmd: string, args: Args): Promise<unknown> {
	switch (cmd) {
		case 'http_send': {
			const result = await ipc.httpSend(args.req as HttpRequestSpec);
			if (!result.ok) throw result.failure;
			return result.exchange;
		}
		case 'auth_window_open':
			return ipc.authWindowOpen(args.args as AuthWindowArgs);
		case 'auth_window_close':
			return ipc.authWindowClose();
		case 'browser_clear_session':
			return ipc.browserClearSession();
		case 'secret_set':
			return ipc.secretSet(args.key as string, args.value as string);
		case 'secret_get':
			return ipc.secretGet(args.key as string);
		case 'secret_delete':
			return ipc.secretDelete(args.key as string);
		case 'doc_read':
			return ipc.docRead(args.path as string);
		case 'doc_write':
			return ipc.docWrite(args.path as string, args.value);
		case 'doc_list':
			return ipc.docList(args.dir as string);
		case 'doc_delete':
			return ipc.docDelete(args.path as string);
		case 'write_text_file':
			return ipc.writeTextFile(args.path as string, args.contents as string);
		case 'read_text_file':
			return ipc.readTextFile(args.path as string);
		case 'plugin:opener|open_url':
			return ipc.openUrl(args.url as string);
		case 'plugin:opener|reveal_item_in_dir':
			return ipc.revealPath(String((args.paths as string[] | undefined)?.[0] ?? ''));
		case 'plugin:app|version':
			return (await ipc.appInfo()).version;
		case 'plugin:app|tauri_version':
			return (await ipc.appInfo()).tauriVersion;
		case 'system_info': {
			const { dataDir, webviewVersion, os } = await ipc.appInfo();
			return { dataDir, webviewVersion, os };
		}
		case 'plugin:dialog|save':
			return ipc.pickSavePath(
				args.options as { defaultPath?: string; filters?: FileDialogFilter[] }
			);
		case 'plugin:dialog|open':
			return ipc.pickOpenPath(args.options as { filters?: FileDialogFilter[] });
		case 'plugin:window|minimize':
		case 'plugin:window|toggle_maximize':
		case 'plugin:window|close':
		case 'plugin:event|unlisten':
			return null;
		case 'plugin:window|is_maximized':
			return false;
		case 'plugin:event|listen':
			return 1;
		default:
			throw new Error(`E2E harness: unhandled command ${cmd}`);
	}
}

export async function dispatch(ipc: NodeIpc, cmd: string, args: unknown): Promise<E2eReply> {
	try {
		return { ok: true, value: await run(ipc, cmd, (args ?? {}) as Args) };
	} catch (error) {
		return {
			ok: false,
			error: typeof error === 'object' && error !== null ? error : String(error)
		};
	}
}
