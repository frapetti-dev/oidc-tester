import type { IpcApi } from '#lib/ipc/types.js';

export const clientSecretKey = (idpId: string) => `idp:${idpId}:client_secret`;
export const passwordKey = (flowId: string) => `flow:${flowId}:password`;

export function errorMessage(e: unknown): string {
	if (typeof e === 'string') return e;
	if (e instanceof Error) return e.message;
	try {
		return JSON.stringify(e);
	} catch {
		return String(e);
	}
}

export type StoreSecretResult = { ok: true } | { ok: false; message: string };

/** Writes the secret to the OS keychain; the caller flips `hasSecret` only on `ok`. */
export async function storeSecret(
	ipc: IpcApi,
	key: string,
	value: string
): Promise<StoreSecretResult> {
	try {
		await ipc.secretSet(key, value);
		return { ok: true };
	} catch (e) {
		return { ok: false, message: `Could not store secret in OS keychain: ${errorMessage(e)}` };
	}
}

export async function clearSecret(ipc: IpcApi, key: string): Promise<void> {
	await ipc.secretDelete(key);
}
