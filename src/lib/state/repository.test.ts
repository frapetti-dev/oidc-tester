import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryIpc, type MemoryIpc } from '#lib/testing/memoryIpc.js';
import {
	newClient,
	newFlow,
	newIdp,
	newWorkspace,
	SCRATCHPAD_ID,
	type Workspace
} from '#lib/model/schema.js';
import type { Run } from '#lib/model/run.js';
import { WorkspaceRepository } from './repository';
import { clearSecret, clientSecretKey, passwordKey, storeSecret } from './secrets';

let ipc: MemoryIpc;
let repo: WorkspaceRepository;

function workspaceWithSecrets(name = 'Alpha'): Workspace {
	const ws = newWorkspace(name);
	const idp = newIdp('IdP 1');
	const client = newClient('Client 1');
	client.hasSecret = true;
	const flow = newFlow('password');
	flow.params.hasPassword = true;
	client.flows.push(flow);
	idp.clients.push(client);
	ws.idps.push(idp);
	ipc.secrets.set(clientSecretKey(client.id), 'client-secret');
	ipc.secrets.set(passwordKey(flow.id), 'pw');
	return ws;
}

function runFor(ws: Workspace): Run {
	const idp = ws.idps[0];
	const client = idp.clients[0];
	const flow = client.flows[0];
	return {
		id: crypto.randomUUID(),
		workspaceId: ws.id,
		idpId: idp.id,
		clientId: client.id,
		flowId: flow.id,
		flowSnapshot: structuredClone(flow),
		idpSnapshot: structuredClone(idp),
		startedAt: '2026-01-01T00:00:00.000Z',
		finishedAt: '2026-01-01T00:00:01.000Z',
		status: 'success',
		navigations: [],
		exchanges: [],
		failures: [],
		tokens: {
			access_token: 'plaintext-access-token',
			raw: { access_token: 'plaintext-access-token' }
		},
		validations: []
	};
}

beforeEach(() => {
	ipc = createMemoryIpc();
	repo = new WorkspaceRepository(ipc);
});

describe('scratchpad', () => {
	it('REQ-WS-001 creates an empty scratchpad when missing and never overwrites an existing one', async () => {
		await repo.ensureScratchpad();
		const created = await repo.load(SCRATCHPAD_ID);
		expect(created).toMatchObject({
			ok: true,
			workspace: { id: 'scratchpad', name: 'Scratchpad', idps: [], schemaVersion: 1 }
		});

		if (!created.ok) throw new Error('unreachable');
		const edited = { ...created.workspace, idps: [newIdp('Keep me')] };
		await repo.save(edited);
		await repo.ensureScratchpad();
		const again = await repo.load(SCRATCHPAD_ID);
		expect(again.ok && again.workspace.idps.map((i) => i.name)).toEqual(['Keep me']);
	});

	it('REQ-WS-003 saveAs moves scratchpad content into a new uuid workspace and resets the scratchpad', async () => {
		await repo.ensureScratchpad();
		const scratch = await repo.load(SCRATCHPAD_ID);
		if (!scratch.ok) throw new Error('unreachable');
		const idp = newIdp('Moved IdP');
		const client = newClient();
		client.flows.push(newFlow('client_credentials'));
		idp.clients.push(client);
		await repo.save({ ...scratch.workspace, idps: [idp] });
		const run = runFor({ ...scratch.workspace, idps: [idp] });
		await repo.saveRun({ ...run, workspaceId: SCRATCHPAD_ID });

		const saved = await repo.saveAs('My workspace');

		expect(saved.id).not.toBe(SCRATCHPAD_ID);
		expect(saved.name).toBe('My workspace');
		expect(saved.idps.map((i) => i.name)).toEqual(['Moved IdP']);
		const reloaded = await repo.load(saved.id);
		expect(reloaded.ok && reloaded.workspace.idps[0].id).toBe(idp.id);
		const emptied = await repo.load(SCRATCHPAD_ID);
		expect(emptied).toMatchObject({ ok: true, workspace: { name: 'Scratchpad', idps: [] } });
		expect(await repo.listRuns(SCRATCHPAD_ID)).toEqual([]);
		const moved = await repo.listRuns(saved.id);
		expect(moved.map((r) => r.workspaceId)).toEqual([saved.id]);
	});
});

describe('listing and opening', () => {
	it('REQ-WS-004 lists Scratchpad first then named workspaces sorted by name; load returns the document', async () => {
		await repo.ensureScratchpad();
		for (const name of ['charlie', 'Alpha', 'bravo']) await repo.save(newWorkspace(name));
		const list = await repo.list();
		expect(list.map((w) => w.name)).toEqual(['Scratchpad', 'Alpha', 'bravo', 'charlie']);
		const loaded = await repo.load(list[1].id);
		expect(loaded).toMatchObject({ ok: true, workspace: { name: 'Alpha' } });
	});
});

describe('rename and delete', () => {
	it('REQ-WS-005 rename changes name and updatedAt', async () => {
		const ws = newWorkspace('Old');
		ws.updatedAt = '2020-01-01T00:00:00.000Z';
		await repo.save(ws);
		const renamed = await repo.rename(ws.id, 'New');
		expect(renamed.name).toBe('New');
		expect(renamed.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
		const loaded = await repo.load(ws.id);
		expect(loaded.ok && loaded.workspace.name).toBe('New');
	});

	it('REQ-WS-005 delete removes the document directory (runs included) and every secret of its IdPs and flows', async () => {
		const ws = workspaceWithSecrets();
		await repo.save(ws);
		await repo.saveRun(runFor(ws));
		ipc.secrets.set('client:other:client_secret', 'unrelated');

		await repo.delete(ws.id);

		expect([...ipc.docs.keys()].filter((k) => k.includes(ws.id))).toEqual([]);
		expect([...ipc.secrets.keys()]).toEqual(['client:other:client_secret']);
	});

	it('REQ-WS-005 the scratchpad cannot be deleted, only cleared (which also drops its secrets)', async () => {
		await repo.ensureScratchpad();
		const scratch = await repo.load(SCRATCHPAD_ID);
		if (!scratch.ok) throw new Error('unreachable');
		const ws = workspaceWithSecrets('Scratchpad');
		await repo.save({ ...ws, id: SCRATCHPAD_ID });

		await expect(repo.delete(SCRATCHPAD_ID)).rejects.toThrow(/scratchpad/i);
		expect(ipc.docs.has('workspaces/scratchpad/workspace.json')).toBe(true);

		await repo.clearScratchpad();
		const cleared = await repo.load(SCRATCHPAD_ID);
		expect(cleared).toMatchObject({ ok: true, workspace: { id: 'scratchpad', idps: [] } });
		expect(ipc.secrets.size).toBe(0);
	});
});

describe('invalid files', () => {
	it('REQ-WS-006 a document failing validation reports "Workspace file is invalid: <message>" and is left untouched', async () => {
		const bad = { schemaVersion: 1, id: 'x', name: 42, idps: [] };
		ipc.docs.set('workspaces/x/workspace.json', bad);
		const result = await repo.load('x');
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('unreachable');
		expect(result.message).toMatch(/^Workspace file is invalid: .*name/);
		expect(ipc.docs.get('workspaces/x/workspace.json')).toEqual(bad);
	});
});

describe('export and import', () => {
	it('REQ-WS-007 export holds format/version/workspace/runs with hasSecret and hasPassword forced false and no secret values', async () => {
		const ws = workspaceWithSecrets('Exported');
		await repo.save(ws);
		await repo.saveRun(runFor(ws));
		ipc.savePath = 'C:/out/Exported.oidcws.json';

		const path = await repo.exportToFile(ws.id);

		expect(path).toBe('C:/out/Exported.oidcws.json');
		const text = ipc.files.get('C:/out/Exported.oidcws.json') ?? '';
		const file = JSON.parse(text);
		expect(file.format).toBe('oidc-tester-workspace');
		expect(file.version).toBe(1);
		expect(file.workspace.idps[0].clients[0].hasSecret).toBe(false);
		expect(file.workspace.idps[0].clients[0].flows[0].params.hasPassword).toBe(false);
		expect(file.runs).toHaveLength(1);
		expect(file.runs[0].idpSnapshot.clients[0].hasSecret).toBe(false);
		expect(file.runs[0].flowSnapshot.params.hasPassword).toBe(false);
		expect(text).not.toContain('client-secret');
		expect(text).not.toContain('"pw"');
	});

	it('REQ-WS-007 export is cancelled without writing when the save dialog is dismissed', async () => {
		const ws = workspaceWithSecrets();
		await repo.save(ws);
		ipc.savePath = null;
		expect(await repo.exportToFile(ws.id)).toBeNull();
		expect(ipc.files.size).toBe(0);
	});

	it('REQ-WS-008 import assigns fresh ids to workspace, IdPs, clients and flows, re-points runs, and stores the result', async () => {
		const ws = workspaceWithSecrets('Source');
		await repo.save(ws);
		await repo.saveRun(runFor(ws));
		ipc.savePath = 'C:/out/source.oidcws.json';
		await repo.exportToFile(ws.id);
		ipc.openPath = 'C:/out/source.oidcws.json';

		const result = await repo.importFromFile();

		expect(result?.ok).toBe(true);
		if (!result?.ok) throw new Error('unreachable');
		const imported = result.workspace;
		expect(imported.id).not.toBe(ws.id);
		expect(imported.idps[0].id).not.toBe(ws.idps[0].id);
		const importedClient = imported.idps[0].clients[0];
		const sourceClient = ws.idps[0].clients[0];
		expect(importedClient.id).not.toBe(sourceClient.id);
		expect(importedClient.flows[0].id).not.toBe(sourceClient.flows[0].id);
		const runs = await repo.listRuns(imported.id);
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({
			workspaceId: imported.id,
			idpId: imported.idps[0].id,
			clientId: importedClient.id,
			flowId: importedClient.flows[0].id
		});
		expect(runs[0].idpSnapshot.id).toBe(imported.idps[0].id);
		expect(runs[0].idpSnapshot.clients[0].id).toBe(importedClient.id);
		expect(runs[0].flowSnapshot.id).toBe(importedClient.flows[0].id);
		const stored = await repo.load(imported.id);
		expect(stored.ok).toBe(true);
	});

	it('REQ-WS-008 invalid files give "Not a valid OIDC Tester workspace file: <reason>" and store nothing', async () => {
		ipc.openPath = 'C:/in/bad.json';
		ipc.files.set('C:/in/bad.json', JSON.stringify({ format: 'something-else' }));
		const before = ipc.docs.size;
		const result = await repo.importFromFile();
		expect(result?.ok).toBe(false);
		if (!result || result.ok) throw new Error('unreachable');
		expect(result.message).toMatch(/^Not a valid OIDC Tester workspace file: .+/);
		expect(ipc.docs.size).toBe(before);

		ipc.files.set('C:/in/bad.json', '{not json');
		const broken = await repo.importFromFile();
		expect(broken && !broken.ok && broken.message).toMatch(
			/^Not a valid OIDC Tester workspace file: /
		);
	});

	it('REQ-WS-008 import returns null when the open dialog is dismissed', async () => {
		ipc.openPath = null;
		expect(await repo.importFromFile()).toBeNull();
	});
});

describe('runs', () => {
	it('REQ-TL-007 runs are persisted with plaintext tokens and can be listed newest first and deleted', async () => {
		const ws = workspaceWithSecrets();
		await repo.save(ws);
		const first = { ...runFor(ws), startedAt: '2026-01-01T00:00:00.000Z' };
		const second = { ...runFor(ws), startedAt: '2026-02-01T00:00:00.000Z' };
		await repo.saveRun(first);
		await repo.saveRun(second);

		const stored = ipc.docs.get(`workspaces/${ws.id}/runs/${first.id}.json`) as Run;
		expect(stored.tokens?.access_token).toBe('plaintext-access-token');

		const runs = await repo.listRuns(ws.id);
		expect(runs.map((r) => r.id)).toEqual([second.id, first.id]);

		await repo.deleteRun(ws.id, first.id);
		expect((await repo.listRuns(ws.id)).map((r) => r.id)).toEqual([second.id]);
	});

	it('REQ-TL-006 history is filtered by IdP', async () => {
		const ws = workspaceWithSecrets();
		await repo.save(ws);
		await repo.saveRun(runFor(ws));
		await repo.saveRun({ ...runFor(ws), idpId: 'another-idp' });
		expect(await repo.listRuns(ws.id, { idpId: ws.idps[0].id })).toHaveLength(1);
	});
});

describe('secrets', () => {
	it('REQ-SEC-002 stores the value via secretSet; failure yields the keychain error message and stores nothing', async () => {
		const ok = await storeSecret(ipc, clientSecretKey('client-1'), 's3cret');
		expect(ok).toEqual({ ok: true });
		expect(ipc.secrets.get('client:client-1:client_secret')).toBe('s3cret');

		ipc.failSecretSet = 'access denied';
		const failed = await storeSecret(ipc, passwordKey('flow-1'), 'pw');
		expect(failed).toEqual({
			ok: false,
			message: 'Could not store secret in OS keychain: access denied'
		});
		expect(ipc.secrets.has('flow:flow-1:password')).toBe(false);
	});

	it('REQ-SEC-003 clearing deletes the keychain entry', async () => {
		ipc.secrets.set('client:client-1:client_secret', 's3cret');
		await clearSecret(ipc, clientSecretKey('client-1'));
		expect(ipc.secrets.size).toBe(0);
	});
});

describe('files written before clients existed', () => {
	const WS_PATH = 'workspaces/old/workspace.json';

	function legacyFixture() {
		const { clients: _clients, ...base } = newIdp('Old IdP');
		const flow = newFlow('client_credentials');
		const idp = {
			...base,
			client: {
				clientId: 'legacy-cid',
				auth: 'client_secret_basic',
				hasSecret: true,
				jwtAlg: 'HS256'
			},
			flows: [flow]
		};
		const workspace = { ...newWorkspace('Old', 'old'), idps: [idp] };
		const run = {
			id: 'run-1',
			workspaceId: 'old',
			idpId: idp.id,
			flowId: flow.id,
			flowSnapshot: flow,
			idpSnapshot: idp,
			startedAt: '2026-01-01T00:00:00.000Z',
			finishedAt: '2026-01-01T00:00:01.000Z',
			status: 'success',
			navigations: [],
			exchanges: [],
			failures: [],
			validations: []
		};
		return { idp, flow, workspace, run };
	}

	it('REQ-WS-011 loads an IdP with client and flows as one Default client and moves its keychain secret', async () => {
		const { idp, flow, workspace } = legacyFixture();
		await ipc.docWrite(WS_PATH, workspace);
		ipc.secrets.set(`idp:${idp.id}:client_secret`, 'old-secret');

		const loaded = await repo.load('old');

		if (!loaded.ok) throw new Error(loaded.message);
		const migrated = loaded.workspace.idps[0];
		expect('client' in migrated).toBe(false);
		expect(migrated.clients).toHaveLength(1);
		expect(migrated.clients[0]).toMatchObject({
			id: idp.id,
			name: 'Default client',
			clientId: 'legacy-cid',
			auth: 'client_secret_basic',
			hasSecret: true,
			jwtAlg: 'HS256'
		});
		expect(migrated.clients[0].flows.map((f) => f.id)).toEqual([flow.id]);
		expect(ipc.secrets.get(clientSecretKey(idp.id))).toBe('old-secret');
		expect(ipc.secrets.has(`idp:${idp.id}:client_secret`)).toBe(false);
		const onDisk = (await ipc.docRead(WS_PATH)) as { idps: Array<Record<string, unknown>> };
		expect(onDisk.idps[0]).toHaveProperty('clients');
		expect(onDisk.idps[0]).not.toHaveProperty('client');
	});

	it('REQ-WS-011 gives runs without clientId the migrated client id and migrates their snapshot', async () => {
		const { idp, run, workspace } = legacyFixture();
		await ipc.docWrite(WS_PATH, workspace);
		await ipc.docWrite(`workspaces/old/runs/${run.id}.json`, run);

		const runs = await repo.listRuns('old');

		expect(runs).toHaveLength(1);
		expect(runs[0].clientId).toBe(idp.id);
		expect(runs[0].idpSnapshot.clients.map((c) => c.id)).toEqual([idp.id]);
		expect(runs[0].idpSnapshot.clients[0].flows.map((f) => f.id)).toEqual([run.flowId]);
	});

	it('REQ-WS-011 keeps the document unmigrated on disk when the keychain copy fails, and retries on the next load', async () => {
		const { idp, workspace } = legacyFixture();
		await ipc.docWrite(WS_PATH, workspace);
		ipc.secrets.set(`idp:${idp.id}:client_secret`, 'old-secret');
		ipc.failSecretSet = 'denied';

		const first = await repo.load('old');

		expect(first.ok).toBe(true);
		expect(await ipc.docRead(WS_PATH)).toEqual(workspace);
		expect(ipc.secrets.get(`idp:${idp.id}:client_secret`)).toBe('old-secret');

		ipc.failSecretSet = null;
		await repo.load('old');

		expect(ipc.secrets.get(clientSecretKey(idp.id))).toBe('old-secret');
		expect(ipc.secrets.has(`idp:${idp.id}:client_secret`)).toBe(false);
		const onDisk = (await ipc.docRead(WS_PATH)) as { idps: Array<Record<string, unknown>> };
		expect(onDisk.idps[0]).toHaveProperty('clients');
	});
});
