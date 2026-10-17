import type { IpcApi } from '#lib/ipc/types.js';
import { RunSchema, type Run } from '#lib/model/run.js';
import {
	SCRATCHPAD_ID,
	WorkspaceSchema,
	newScratchpad,
	nowIso,
	newWorkspace,
	secretKeys,
	type Workspace
} from '#lib/model/schema.js';
import {
	BUNDLE_FORMAT,
	BUNDLE_VERSION,
	describeZodError,
	importedEntry,
	parseImportFile,
	withoutSecretFlags,
	type Bundle,
	type BundleEntry,
	type ParsedImport
} from '#lib/model/workspaceFile.js';
import type { BundleSettings } from '#lib/model/settings.js';
import { legacyClientSecretKey, legacyIdpIds } from '#lib/model/legacy.js';
import { clientSecretKey, errorMessage } from './secrets';

const WORKSPACES_DIR = 'workspaces';
const wsDir = (id: string) => `${WORKSPACES_DIR}/${id}`;
const wsDoc = (id: string) => `${wsDir(id)}/workspace.json`;
const runsDir = (wsId: string) => `${wsDir(wsId)}/runs`;
const runDoc = (wsId: string, runId: string) => `${runsDir(wsId)}/${runId}.json`;

const FILE_FILTERS = [{ name: 'OIDC Tester export', extensions: ['json'] }];

export type LoadResult = { ok: true; workspace: Workspace } | { ok: false; message: string };
export interface BundleOptions {
	runs: boolean;
	settings: BundleSettings | null;
}
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
		await this.persistLegacyMigration(raw, parsed.data);
		return { ok: true, workspace: parsed.data };
	}

	/**
	 * REQ-WS-011: for a document still in the pre-clients shape, moves each IdP's keychain secret
	 * to its client's key, then writes the migrated document back. A keychain failure leaves the
	 * document as it was on disk so the next load retries.
	 */
	private async persistLegacyMigration(raw: unknown, migrated: Workspace): Promise<void> {
		const legacyIds = legacyIdpIds(raw);
		if (legacyIds.length === 0) return;
		try {
			for (const idpId of legacyIds) {
				const secret = await this.ipc.secretGet(legacyClientSecretKey(idpId));
				if (secret === null) continue;
				await this.ipc.secretSet(clientSecretKey(idpId), secret);
				await this.ipc.secretDelete(legacyClientSecretKey(idpId));
			}
		} catch {
			return;
		}
		await this.save(migrated);
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

	async deleteRuns(wsId: string, runIds: string[]): Promise<void> {
		for (const id of runIds) await this.deleteRun(wsId, id);
	}

	async buildBundle(ids: string[], opts: BundleOptions): Promise<Bundle> {
		const workspaces: BundleEntry[] = [];
		for (const id of ids) {
			const loaded = await this.load(id);
			if (!loaded.ok) throw new Error(`${id}: ${loaded.message}`);
			workspaces.push(
				withoutSecretFlags(loaded.workspace, opts.runs ? await this.listRuns(id) : [])
			);
		}
		const bundle: Bundle = {
			format: BUNDLE_FORMAT,
			version: BUNDLE_VERSION,
			exportedAt: nowIso(),
			workspaces
		};
		if (opts.settings) bundle.settings = opts.settings;
		return bundle;
	}

	/** Returns the written path, or null when the save dialog was dismissed. */
	async writeBundle(bundle: Bundle, defaultName: string): Promise<string | null> {
		const path = await this.ipc.pickSavePath({ defaultPath: defaultName, filters: FILE_FILTERS });
		if (path === null) return null;
		await this.ipc.writeTextFile(path, JSON.stringify(bundle, null, 2));
		return path;
	}

	/** Null when the open dialog was dismissed. */
	async readImportFile(): Promise<ParsedImport | null> {
		const path = await this.ipc.pickOpenPath({ filters: FILE_FILTERS });
		if (path === null) return null;
		let text: string;
		try {
			text = await this.ipc.readTextFile(path);
		} catch (e) {
			return { ok: false, message: `Not a valid OIDC Tester export file: ${errorMessage(e)}` };
		}
		return parseImportFile(text);
	}

	/** Stores the entries under fresh ids; returns the new workspaces in input order. */
	async importEntries(entries: BundleEntry[]): Promise<Workspace[]> {
		const imported: Workspace[] = [];
		for (const entry of entries) {
			const fresh = importedEntry(entry);
			await this.save(fresh.workspace);
			for (const run of fresh.runs) await this.saveRun(run);
			imported.push(fresh.workspace);
		}
		return imported;
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
