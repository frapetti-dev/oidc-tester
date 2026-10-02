import type { IpcApi } from '$lib/ipc/types';
import { RunSchema, type Run } from '$lib/model/run';
import {
	SCRATCHPAD_ID,
	WorkspaceSchema,
	newScratchpad,
	nowIso,
	newWorkspace,
	secretKeys,
	type Workspace
} from '$lib/model/schema';
import {
	EXPORT_FORMAT,
	EXPORT_VERSION,
	WorkspaceFileSchema,
	describeZodError,
	withFreshIds,
	withoutSecretFlags,
	type WorkspaceFile
} from '$lib/model/workspaceFile';
import { errorMessage } from './secrets';

const WORKSPACES_DIR = 'workspaces';
const wsDir = (id: string) => `${WORKSPACES_DIR}/${id}`;
const wsDoc = (id: string) => `${wsDir(id)}/workspace.json`;
const runsDir = (wsId: string) => `${wsDir(wsId)}/runs`;
const runDoc = (wsId: string, runId: string) => `${runsDir(wsId)}/${runId}.json`;

const FILE_FILTERS = [{ name: 'OIDC Tester workspace', extensions: ['json'] }];

export type LoadResult = { ok: true; workspace: Workspace } | { ok: false; message: string };
export type ImportResult = { ok: true; workspace: Workspace } | { ok: false; message: string };
export interface WorkspaceSummary {
	id: string;
	name: string;
}

/** Workspace and run documents on top of the generic `doc_*` IPC commands. */
export class WorkspaceRepository {
	private readonly ipc: IpcApi;

	constructor(ipc: IpcApi) {
		this.ipc = ipc;
	}

	async ensureScratchpad(): Promise<void> {
		if ((await this.ipc.docRead(wsDoc(SCRATCHPAD_ID))) === null) {
			await this.save(newScratchpad());
		}
	}

	async load(id: string): Promise<LoadResult> {
		const raw = await this.ipc.docRead(wsDoc(id));
		if (raw === null) return { ok: false, message: `Workspace not found: ${id}` };
		const parsed = WorkspaceSchema.safeParse(raw);
		if (!parsed.success) {
			return { ok: false, message: `Workspace file is invalid: ${describeZodError(parsed.error)}` };
		}
		return { ok: true, workspace: parsed.data };
	}

	async save(ws: Workspace): Promise<void> {
		await this.ipc.docWrite(wsDoc(ws.id), ws);
	}

	/** Scratchpad first, then named workspaces sorted by name. Unreadable documents list by id. */
	async list(): Promise<WorkspaceSummary[]> {
		const ids = await this.ipc.docList(WORKSPACES_DIR);
		const all = await Promise.all(
			ids.map(async (id): Promise<WorkspaceSummary> => {
				const loaded = await this.load(id);
				return { id, name: loaded.ok ? loaded.workspace.name : id };
			})
		);
		const named = all
			.filter((w) => w.id !== SCRATCHPAD_ID)
			.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
		const scratch = all.find((w) => w.id === SCRATCHPAD_ID);
		return scratch ? [scratch, ...named] : named;
	}

	async rename(id: string, name: string): Promise<Workspace> {
		const loaded = await this.requireValid(id);
		const renamed = { ...loaded, name, updatedAt: nowIso() };
		await this.save(renamed);
		return renamed;
	}

	/** Moves the scratchpad (document, runs) into a new named workspace and resets the scratchpad. */
	async saveAs(name: string): Promise<Workspace> {
		const scratch = await this.requireValid(SCRATCHPAD_ID);
		const created = newWorkspace(name);
		const saved: Workspace = {
			...scratch,
			id: created.id,
			name,
			createdAt: created.createdAt,
			updatedAt: created.updatedAt
		};
		await this.save(saved);
		for (const run of await this.listRuns(SCRATCHPAD_ID)) {
			await this.saveRun({ ...run, workspaceId: saved.id });
		}
		await this.ipc.docDelete(runsDir(SCRATCHPAD_ID));
		await this.save(newScratchpad());
		return saved;
	}

	async clearScratchpad(): Promise<void> {
		const loaded = await this.load(SCRATCHPAD_ID);
		if (loaded.ok) await this.deleteSecrets(loaded.workspace);
		await this.ipc.docDelete(runsDir(SCRATCHPAD_ID));
		await this.save(newScratchpad());
	}

	async delete(id: string): Promise<void> {
		if (id === SCRATCHPAD_ID) {
			throw new Error('The scratchpad cannot be deleted; clear it instead');
		}
		const loaded = await this.load(id);
		if (loaded.ok) await this.deleteSecrets(loaded.workspace);
		await this.ipc.docDelete(wsDir(id));
	}

	async saveRun(run: Run): Promise<void> {
		await this.ipc.docWrite(runDoc(run.workspaceId, run.id), run);
	}

	/** Newest first. Documents failing validation are skipped. */
	async listRuns(wsId: string, filter: { idpId?: string } = {}): Promise<Run[]> {
		const ids = await this.ipc.docList(runsDir(wsId));
		const runs: Run[] = [];
		for (const id of ids) {
			const parsed = RunSchema.safeParse(await this.ipc.docRead(runDoc(wsId, id)));
			if (parsed.success && (!filter.idpId || parsed.data.idpId === filter.idpId)) {
				runs.push(parsed.data);
			}
		}
		return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
	}

	async deleteRun(wsId: string, runId: string): Promise<void> {
		await this.ipc.docDelete(runDoc(wsId, runId));
	}

	async buildExport(id: string): Promise<WorkspaceFile> {
		const ws = await this.requireValid(id);
		const stripped = withoutSecretFlags(ws, await this.listRuns(id));
		return { format: EXPORT_FORMAT, version: EXPORT_VERSION, ...stripped };
	}

	/** Returns the written path, or null when the save dialog was dismissed. */
	async exportToFile(id: string): Promise<string | null> {
		const file = await this.buildExport(id);
		const path = await this.ipc.pickSavePath({
			defaultPath: `${file.workspace.name}.oidcws.json`,
			filters: FILE_FILTERS
		});
		if (path === null) return null;
		await this.ipc.writeTextFile(path, JSON.stringify(file, null, 2));
		return path;
	}

	/** Null when the open dialog was dismissed. */
	async importFromFile(): Promise<ImportResult | null> {
		const path = await this.ipc.pickOpenPath({ filters: FILE_FILTERS });
		if (path === null) return null;
		const invalid = (reason: string): ImportResult => ({
			ok: false,
			message: `Not a valid OIDC Tester workspace file: ${reason}`
		});
		let json: unknown;
		try {
			json = JSON.parse(await this.ipc.readTextFile(path));
		} catch (e) {
			return invalid(errorMessage(e));
		}
		const parsed = WorkspaceFileSchema.safeParse(json);
		if (!parsed.success) return invalid(describeZodError(parsed.error));
		const fresh = withFreshIds(parsed.data);
		await this.save(fresh.workspace);
		for (const run of fresh.runs) await this.saveRun(run);
		return { ok: true, workspace: fresh.workspace };
	}

	private async requireValid(id: string): Promise<Workspace> {
		const loaded = await this.load(id);
		if (!loaded.ok) throw new Error(loaded.message);
		return loaded.workspace;
	}

	private async deleteSecrets(ws: Workspace): Promise<void> {
		for (const key of secretKeys(ws)) await this.ipc.secretDelete(key);
	}
}
