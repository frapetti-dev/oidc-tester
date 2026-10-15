import type { IpcApi } from '#lib/ipc/types.js';
import {
	SCRATCHPAD_ID,
	nowIso,
	type Client,
	type Flow,
	type FlowType,
	type Idp,
	type Workspace
} from '#lib/model/schema.js';
import { createDebouncedSaver, type DebouncedSaver } from './autosave';
import {
	addClient,
	addFlow,
	addIdp,
	deleteClient,
	deleteFlow,
	deleteIdp,
	duplicateClient,
	duplicateFlow,
	duplicateIdp,
	type SecretCopy
} from './ops';
import { WorkspaceRepository, type WorkspaceSummary } from './repository';
import { clearSecret, clientSecretKey, errorMessage, passwordKey, storeSecret } from './secrets';

export const AUTOSAVE_DELAY_MS = 500;

export interface Selection {
	idpId: string | null;
	clientId: string | null;
	flowId: string | null;
}

/** Selection of the IdP's first client and that client's first flow. */
function firstSelection(idp: Idp | null | undefined): Selection {
	const client = idp?.clients[0];
	return {
		idpId: idp?.id ?? null,
		clientId: client?.id ?? null,
		flowId: client?.flows[0]?.id ?? null
	};
}

/** Reactive state for the open workspace, with debounced autosave. */
export class WorkspaceStore {
	current = $state<Workspace | null>(null);
	workspaces = $state<WorkspaceSummary[]>([]);
	/** Set when the open file failed validation; autosave is disabled while set. */
	banner = $state<string | null>(null);
	toast = $state<string | null>(null);
	selection = $state<Selection>({ idpId: null, clientId: null, flowId: null });

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

	get selectedClient(): Client | null {
		return this.selectedIdp?.clients.find((c) => c.id === this.selection.clientId) ?? null;
	}

	get selectedFlow(): Flow | null {
		return this.selectedClient?.flows.find((f) => f.id === this.selection.flowId) ?? null;
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
			this.selection = { idpId: null, clientId: null, flowId: null };
			return;
		}
		this.banner = null;
		this.lastSaved = JSON.stringify(loaded.workspace);
		this.current = loaded.workspace;
		this.selection = firstSelection(loaded.workspace.idps[0]);
	}

	selectIdp(idpId: string): void {
		this.selection = firstSelection(this.current?.idps.find((i) => i.id === idpId));
	}

	selectClient(idpId: string, clientId: string): void {
		const client = this.current?.idps
			.find((i) => i.id === idpId)
			?.clients.find((c) => c.id === clientId);
		this.selection = { idpId, clientId, flowId: client?.flows[0]?.id ?? null };
	}

	selectFlow(idpId: string, clientId: string, flowId: string): void {
		this.selection = { idpId, clientId, flowId };
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
		this.selection = { idpId: idp.id, clientId: null, flowId: null };
		return idp;
	}

	addClient(idpId: string): Client | null {
		const idp = this.current?.idps.find((i) => i.id === idpId);
		if (!idp) return null;
		const client = addClient(idp);
		this.selection = { idpId, clientId: client.id, flowId: null };
		return client;
	}

	addFlow(idpId: string, clientId: string, type: FlowType): Flow | null {
		const client = this.findClient(idpId, clientId);
		if (!client) return null;
		const flow = addFlow(client, type);
		this.selection = { idpId, clientId, flowId: flow.id };
		return flow;
	}

	async duplicateIdp(idpId: string): Promise<void> {
		if (!this.current) return;
		const { copy, secretCopies } = duplicateIdp(this.current, idpId);
		this.selection = firstSelection(copy);
		await this.copySecrets(secretCopies, copy.clients);
	}

	async duplicateClient(idpId: string, clientId: string): Promise<void> {
		const idp = this.current?.idps.find((i) => i.id === idpId);
		if (!idp) return;
		const { copy, secretCopies } = duplicateClient(idp, clientId);
		this.selection = { idpId, clientId: copy.id, flowId: copy.flows[0]?.id ?? null };
		await this.copySecrets(secretCopies, [copy]);
	}

	async duplicateFlow(idpId: string, clientId: string, flowId: string): Promise<void> {
		const client = this.findClient(idpId, clientId);
		if (!client) return;
		const { copy, secretCopies } = duplicateFlow(client, flowId);
		this.selection = { idpId, clientId, flowId: copy.id };
		await this.copySecrets(secretCopies, [client]);
	}

	async deleteIdp(idpId: string): Promise<void> {
		if (!this.current) return;
		const keys = deleteIdp(this.current, idpId);
		for (const key of keys) await clearSecret(this.ipc, key);
		if (this.selection.idpId === idpId) this.selection = firstSelection(this.current.idps[0]);
	}

	async deleteClient(idpId: string, clientId: string): Promise<void> {
		const idp = this.current?.idps.find((i) => i.id === idpId);
		if (!idp) return;
		for (const key of deleteClient(idp, clientId)) await clearSecret(this.ipc, key);
		if (this.selection.clientId === clientId) {
			const next = idp.clients[0];
			this.selection = { idpId, clientId: next?.id ?? null, flowId: next?.flows[0]?.id ?? null };
		}
	}

	async deleteFlow(idpId: string, clientId: string, flowId: string): Promise<void> {
		const client = this.findClient(idpId, clientId);
		if (!client) return;
		for (const key of deleteFlow(client, flowId)) await clearSecret(this.ipc, key);
		if (this.selection.flowId === flowId) {
			this.selection = { idpId, clientId, flowId: client.flows[0]?.id ?? null };
		}
	}

	/** Stores the client secret in the keychain; the workspace JSON only gets the flag. */
	async setClientSecret(client: Client, value: string): Promise<void> {
		const result = await storeSecret(this.ipc, clientSecretKey(client.id), value);
		if (result.ok) client.hasSecret = true;
		else this.toast = result.message;
	}

	async clearClientSecret(client: Client): Promise<void> {
		await clearSecret(this.ipc, clientSecretKey(client.id));
		client.hasSecret = false;
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

	private findClient(idpId: string, clientId: string): Client | undefined {
		return this.current?.idps.find((i) => i.id === idpId)?.clients.find((c) => c.id === clientId);
	}

	/** Copies keychain entries; on failure the flag of the affected copy (found in `clients`) is cleared. */
	private async copySecrets(copies: SecretCopy[], clients: Client[]): Promise<void> {
		for (const { from, to } of copies) {
			try {
				const value = await this.ipc.secretGet(from);
				if (value !== null) await this.ipc.secretSet(to, value);
			} catch (e) {
				this.toast = `Could not copy secret: ${errorMessage(e)}`;
				for (const client of clients) {
					if (clientSecretKey(client.id) === to) client.hasSecret = false;
					for (const flow of client.flows) {
						if (passwordKey(flow.id) === to) flow.params.hasPassword = false;
					}
				}
			}
		}
	}
}
