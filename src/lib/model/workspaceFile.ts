import { z } from 'zod';
import { RunSchema, type Run } from './run';
import { WorkspaceSchema, newId, type Idp, type Workspace } from './schema';

export const EXPORT_FORMAT = 'oidc-tester-workspace';
export const EXPORT_VERSION = 1;

export const WorkspaceFileSchema = z.object({
	format: z.literal(EXPORT_FORMAT),
	version: z.literal(EXPORT_VERSION),
	workspace: WorkspaceSchema,
	runs: z.array(RunSchema)
});
export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;

export function describeZodError(err: z.ZodError): string {
	return err.issues
		.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
		.join('; ');
}

function stripIdpSecrets(idp: Idp): Idp {
	return {
		...idp,
		client: { ...idp.client, hasSecret: false },
		flows: idp.flows.map((f) => ({ ...f, params: { ...f.params, hasPassword: false } }))
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

/** Fresh uuids for workspace, IdPs and flows; runs (and their snapshots) are re-pointed. */
export function withFreshIds(file: { workspace: Workspace; runs: Run[] }): {
	workspace: Workspace;
	runs: Run[];
} {
	const workspaceId = newId();
	const idpIds = new Map<string, string>();
	const flowIds = new Map<string, string>();
	for (const idp of file.workspace.idps) {
		idpIds.set(idp.id, newId());
		for (const flow of idp.flows) flowIds.set(flow.id, newId());
	}
	const remapIdp = (idp: Idp): Idp => ({
		...idp,
		id: idpIds.get(idp.id) ?? idp.id,
		flows: idp.flows.map((f) => ({ ...f, id: flowIds.get(f.id) ?? f.id }))
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
			flowId: flowIds.get(r.flowId) ?? r.flowId,
			idpSnapshot: remapIdp(r.idpSnapshot),
			flowSnapshot: { ...r.flowSnapshot, id: flowIds.get(r.flowSnapshot.id) ?? r.flowSnapshot.id }
		}))
	};
}
