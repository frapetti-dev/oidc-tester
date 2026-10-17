import { z } from 'zod';
import { RunSchema, type Run } from './run';
import { SCRATCHPAD_ID, WorkspaceSchema, newId, type Idp, type Workspace } from './schema';
import { BundleSettingsSchema, type BundleSettings } from './settings';

/** Pre-bundle single-workspace format: import only. */
export const LEGACY_FORMAT = 'oidc-tester-workspace';
export const LegacyWorkspaceFileSchema = z.object({
	format: z.literal(LEGACY_FORMAT),
	version: z.literal(1),
	workspace: WorkspaceSchema,
	runs: z.array(RunSchema)
});
export type LegacyWorkspaceFile = z.infer<typeof LegacyWorkspaceFileSchema>;

export const BUNDLE_FORMAT = 'oidc-tester-bundle';
export const BUNDLE_VERSION = 1;
export const BUNDLE_EXTENSION = '.oidcbundle.json';

export const BundleEntrySchema = z.object({ workspace: WorkspaceSchema, runs: z.array(RunSchema) });
export const BundleSchema = z.object({
	format: z.literal(BUNDLE_FORMAT),
	version: z.literal(BUNDLE_VERSION),
	exportedAt: z.string(),
	workspaces: z.array(BundleEntrySchema).min(1),
	settings: BundleSettingsSchema.optional()
});
export type BundleEntry = z.infer<typeof BundleEntrySchema>;
export type Bundle = z.infer<typeof BundleSchema>;

export type ParsedImport =
	| { ok: true; entries: BundleEntry[]; settings: BundleSettings | null }
	| { ok: false; message: string };

export function describeZodError(err: z.ZodError): string {
	return err.issues
		.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
		.join('; ');
}

function stripIdpSecrets(idp: Idp): Idp {
	return {
		...idp,
		clients: idp.clients.map((client) => ({
			...client,
			hasSecret: false,
			flows: client.flows.map((f) => ({ ...f, params: { ...f.params, hasPassword: false } }))
		}))
	};
}

/** Copy of the workspace (and runs' snapshots) with every secret flag cleared. */
export function withoutSecretFlags(
	ws: Workspace,
	runs: Run[]
): { workspace: Workspace; runs: Run[] } {
	return {
		workspace: { ...ws, idps: ws.idps.map(stripIdpSecrets) },
		runs: runs.map((r) => ({
			...r,
			idpSnapshot: stripIdpSecrets(r.idpSnapshot),
			flowSnapshot: {
				...r.flowSnapshot,
				params: { ...r.flowSnapshot.params, hasPassword: false }
			}
		}))
	};
}

/** Fresh uuids for workspace, IdPs, clients and flows; runs (and their snapshots) are re-pointed. */
export function withFreshIds(file: { workspace: Workspace; runs: Run[] }): {
	workspace: Workspace;
	runs: Run[];
} {
	const workspaceId = newId();
	const idpIds = new Map<string, string>();
	const clientIds = new Map<string, string>();
	const flowIds = new Map<string, string>();
	for (const idp of file.workspace.idps) {
		idpIds.set(idp.id, newId());
		for (const client of idp.clients) {
			clientIds.set(client.id, newId());
			for (const flow of client.flows) flowIds.set(flow.id, newId());
		}
	}
	const remapIdp = (idp: Idp): Idp => ({
		...idp,
		id: idpIds.get(idp.id) ?? idp.id,
		clients: idp.clients.map((c) => ({
			...c,
			id: clientIds.get(c.id) ?? c.id,
			flows: c.flows.map((f) => ({ ...f, id: flowIds.get(f.id) ?? f.id }))
		}))
	});
	const now = new Date().toISOString();
	return {
		workspace: {
			...file.workspace,
			id: workspaceId,
			createdAt: now,
			updatedAt: now,
			idps: file.workspace.idps.map(remapIdp)
		},
		runs: file.runs.map((r) => ({
			...r,
			id: newId(),
			workspaceId,
			idpId: idpIds.get(r.idpId) ?? r.idpId,
			clientId: clientIds.get(r.clientId) ?? r.clientId,
			flowId: flowIds.get(r.flowId) ?? r.flowId,
			idpSnapshot: remapIdp(r.idpSnapshot),
			flowSnapshot: { ...r.flowSnapshot, id: flowIds.get(r.flowSnapshot.id) ?? r.flowSnapshot.id }
		}))
	};
}

const INVALID_PREFIX = 'Not a valid OIDC Tester export file: ';

/** Parses an export file: a bundle, or a legacy single-workspace file. */
export function parseImportFile(text: string): ParsedImport {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		return { ok: false, message: INVALID_PREFIX + (e instanceof Error ? e.message : String(e)) };
	}
	const bundle = BundleSchema.safeParse(raw);
	if (bundle.success) {
		return { ok: true, entries: bundle.data.workspaces, settings: bundle.data.settings ?? null };
	}
	const isLegacy =
		typeof raw === 'object' && raw !== null && 'format' in raw && raw.format === LEGACY_FORMAT;
	if (isLegacy) {
		const legacy = LegacyWorkspaceFileSchema.safeParse(raw);
		if (legacy.success) {
			const { workspace, runs } = legacy.data;
			return { ok: true, entries: [{ workspace, runs }], settings: null };
		}
		return { ok: false, message: INVALID_PREFIX + describeZodError(legacy.error) };
	}
	return { ok: false, message: INVALID_PREFIX + describeZodError(bundle.error) };
}

/** Fresh ids for an imported entry; an imported scratchpad becomes `Scratchpad (imported)`. */
export function importedEntry(entry: BundleEntry): BundleEntry {
	const fresh = withFreshIds(entry);
	if (entry.workspace.id === SCRATCHPAD_ID) fresh.workspace.name = 'Scratchpad (imported)';
	return fresh;
}
