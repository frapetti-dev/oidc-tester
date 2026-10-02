import type { IpcApi } from '$lib/ipc/types';
import {
	SCRATCHPAD_ID,
	nowIso,
	type Flow,
	type FlowType,
	type Idp,
	type Workspace
} from '$lib/model/schema';
import { createDebouncedSaver, type DebouncedSaver } from './autosave';
import {
	addFlow,
	addIdp,
	deleteFlow,
	deleteIdp,
	duplicateFlow,
	duplicateIdp,
	type SecretCopy
} from './ops';
import { WorkspaceRepository, type WorkspaceSummary } from './repository';
import { clearSecret, clientSecretKey, errorMessage, passwordKey, storeSecret } from './secrets';

export const AUTOSAVE_DELAY_MS = 500;

export interface Selection {
	idpId: string | null;
	flowId: string | null;
}

/** Reactive state for the open workspace, with debounced autosave. */
export class WorkspaceStore {
	current = $state<Workspace | null>(null);
	workspaces = $state<WorkspaceSummary[]>([]);
	/** Set when the open file failed validation; autosave is disabled while set. */
	banner = $state<string | null>(null);
	toast = $state<string | null>(null);
	selection = $state<Selection>({ idpId: null, flowId: null });

	readonly repo: WorkspaceRepository;
	private readonly ipc: IpcApi;
	private readonly saver: DebouncedSaver<Workspace>;
	private lastSaved = '';
	private disposeEffects: (() => void) | null = null;

	constructor(ipc: IpcApi) {
		this.ipc = ipc;
		this.repo = new WorkspaceRepository(ipc);
		this.saver = createDebouncedSaver(async (ws) => {
			const toWrite = { ...ws, updatedAt: nowIso() };
			this.lastSaved = JSON.stringify(ws);
			await this.repo.save(toWrite);
		}, AUTOSAVE_DELAY_MS);
	}

	get selectedIdp(): Idp | null {
		return this.current?.idps.find((i) => i.id === this.selection.idpId) ?? null;
	}

	get selectedFlow(): Flow | null {
		return this.selectedIdp?.flows.find((f) => f.id === this.selection.flowId) ?? null;
	}

	/** Creates the scratchpad when missing, opens it, and starts autosave. */
	async init(): Promise<void> {
		await this.repo.ensureScratchpad();
		await this.refreshList();
		await this.open(SCRATCHPAD_ID);
		this.startAutosave();
	}

	startAutosave(): void {
		if (this.disposeEffects) return;
		this.disposeEffects = $effect.root(() => {
			$effect(() => {
				const ws = this.current;
				if (!ws || this.banner !== null) return;
				const snapshot = $state.snapshot(ws);
				if (JSON.stringify(snapshot) === this.lastSaved) return;
				this.saver.schedule(snapshot);
			});
		});
	}

	dispose(): void {
		this.disposeEffects?.();
		this.disposeEffects = null;
		this.saver.cancel();
	}

	async refreshList(): Promise<void> {
		this.workspaces = await this.repo.list();
	}

	async open(id: string): Promise<void> {
		await this.persistNow();
		const loaded = await this.repo.load(id);
		if (!loaded.ok) {
			this.banner = loaded.message;
			this.current = null;
			this.selection = { idpId: null, flowId: null };
			return;
		}
		this.banner = null;
		this.lastSaved = JSON.stringify(loaded.workspace);
		this.current = loaded.workspace;
		const firstIdp = loaded.workspace.idps[0] ?? null;
		this.selection = { idpId: firstIdp?.id ?? null, flowId: firstIdp?.flows[0]?.id ?? null };
	}

	selectIdp(idpId: string): void {
		const idp = this.current?.idps.find((i) => i.id === idpId);
		this.selection = { idpId, flowId: idp?.flows[0]?.id ?? null };
	}

	selectFlow(idpId: string, flowId: string): void {
		this.selection = { idpId, flowId };
	}

	async saveAs(name: string): Promise<void> {
		await this.persistNow();
		const saved = await this.repo.saveAs(name);
		await this.refreshList();
		await this.open(saved.id);
	}

	async rename(name: string): Promise<void> {
		if (!this.current) return;
		await this.persistNow();
		const renamed = await this.repo.rename(this.current.id, name);
		this.current.name = renamed.name;
		this.current.updatedAt = renamed.updatedAt;
		this.lastSaved = JSON.stringify($state.snapshot(this.current));
		await this.refreshList();
	}

	/** Writes the open workspace immediately (cancelling any pending debounce). */
	private async persistNow(): Promise<void> {
		this.saver.cancel();
		if (!this.current || this.banner !== null) return;
		const snapshot = $state.snapshot(this.current);
		if (JSON.stringify(snapshot) === this.lastSaved) return;
		this.lastSaved = JSON.stringify(snapshot);
		await this.repo.save({ ...snapshot, updatedAt: nowIso() });
	}

	async deleteCurrent(): Promise<void> {
		if (!this.current) return;
		const id = this.current.id;
		this.saver.cancel();
		if (id === SCRATCHPAD_ID) await this.repo.clearScratchpad();
		else await this.repo.delete(id);
		await this.refreshList();
		await this.open(SCRATCHPAD_ID);
	}

	async exportCurrent(): Promise<string | null> {
		if (!this.current) return null;
		await this.persistNow();
		return this.repo.exportToFile(this.current.id);
	}

	async importWorkspace(): Promise<void> {
		const result = await this.repo.importFromFile();
		if (result === null) return;
		if (!result.ok) {
			this.toast = result.message;
			return;
		}
		await this.refreshList();
		await this.open(result.workspace.id);
	}

	addIdp(): Idp | null {
		if (!this.current) return null;
		const idp = addIdp(this.current);
		this.selection = { idpId: idp.id, flowId: null };
		return idp;
	}

	addFlow(idpId: string, type: FlowType): Flow | null {
		const idp = this.current?.idps.find((i) => i.id === idpId);
		if (!idp) return null;
		const flow = addFlow(idp, type);
		this.selection = { idpId, flowId: flow.id };
		return flow;
	}

	async duplicateIdp(idpId: string): Promise<void> {
		if (!this.current) return;
		const { copy, secretCopies } = duplicateIdp(this.current, idpId);
		this.selection = { idpId: copy.id, flowId: copy.flows[0]?.id ?? null };
		await this.copySecrets(secretCopies, copy);
	}

	async duplicateFlow(idpId: string, flowId: string): Promise<void> {
		const idp = this.current?.idps.find((i) => i.id === idpId);
		if (!idp) return;
		const { copy, secretCopies } = duplicateFlow(idp, flowId);
		this.selection = { idpId, flowId: copy.id };
		await this.copySecrets(secretCopies, null, copy);
	}

	async deleteIdp(idpId: string): Promise<void> {
		if (!this.current) return;
		const keys = deleteIdp(this.current, idpId);
		for (const key of keys) await clearSecret(this.ipc, key);
		if (this.selection.idpId === idpId) {
			const next = this.current.idps[0] ?? null;
			this.selection = { idpId: next?.id ?? null, flowId: next?.flows[0]?.id ?? null };
		}
	}

	async deleteFlow(idpId: string, flowId: string): Promise<void> {
		const idp = this.current?.idps.find((i) => i.id === idpId);
		if (!idp) return;
		for (const key of deleteFlow(idp, flowId)) await clearSecret(this.ipc, key);
		if (this.selection.flowId === flowId)
			this.selection = { idpId, flowId: idp.flows[0]?.id ?? null };
	}

	/** Stores the client secret in the keychain; the workspace JSON only gets the flag. */
	async setClientSecret(idp: Idp, value: string): Promise<void> {
		const result = await storeSecret(this.ipc, clientSecretKey(idp.id), value);
		if (result.ok) idp.client.hasSecret = true;
		else this.toast = result.message;
	}

	async clearClientSecret(idp: Idp): Promise<void> {
		await clearSecret(this.ipc, clientSecretKey(idp.id));
		idp.client.hasSecret = false;
	}

	async setFlowPassword(flow: Flow, value: string): Promise<void> {
		const result = await storeSecret(this.ipc, passwordKey(flow.id), value);
		if (result.ok) flow.params.hasPassword = true;
		else this.toast = result.message;
	}

	async clearFlowPassword(flow: Flow): Promise<void> {
		await clearSecret(this.ipc, passwordKey(flow.id));
		flow.params.hasPassword = false;
	}

	private async copySecrets(copies: SecretCopy[], idp: Idp | null, flow?: Flow): Promise<void> {
		for (const { from, to } of copies) {
			try {
				const value = await this.ipc.secretGet(from);
				if (value !== null) await this.ipc.secretSet(to, value);
			} catch (e) {
				this.toast = `Could not copy secret: ${errorMessage(e)}`;
				if (to.endsWith(':client_secret') && idp) idp.client.hasSecret = false;
				if (to.endsWith(':password')) {
					const target = flow ?? idp?.flows.find((f) => passwordKey(f.id) === to);
					if (target) target.params.hasPassword = false;
				}
			}
		}
	}
}
