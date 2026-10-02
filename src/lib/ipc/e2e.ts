import { mockIPC } from '@tauri-apps/api/mocks';

/** Envelope the Playwright harness returns for every command. */
export type E2eReply = { ok: true; value: unknown } | { ok: false; error: unknown };

declare global {
	interface Window {
		/** Exposed by the Playwright web fixture (`page.exposeFunction`). */
		__e2eInvoke?: (cmd: string, args: unknown) => Promise<E2eReply>;
	}
}

/** Forwards every `invoke(cmd, args)` (including plugin commands) to `window.__e2eInvoke`. */
export function installE2eIpc(): void {
	mockIPC(async (cmd, args) => {
		const bridge = window.__e2eInvoke;
		if (!bridge) throw new Error('window.__e2eInvoke is not exposed');
		const reply = await bridge(cmd, args);
		if (!reply.ok) throw reply.error;
		return reply.value;
	});
}
