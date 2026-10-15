import { describe, expect, it } from 'vitest';
import type { Run } from '#lib/model/run.js';
import { newClient, newFlow, newIdp, newId } from '#lib/model/schema.js';
import type { RunContext } from '#lib/run/engine.js';
import { createMemoryIpc } from '#lib/testing/memoryIpc.js';
import { WorkspaceRepository } from './repository';
import { RunnerStore } from './runner.svelte';

function runFor(
	ctx: RunContext,
	status: Run['status'],
	startedAt = '2026-10-02T10:00:00.000Z'
): Run {
	return {
		id: newId(),
		workspaceId: ctx.workspaceId,
		idpId: ctx.idp.id,
		clientId: ctx.client.id,
		flowId: ctx.flow.id,
		flowSnapshot: ctx.flow,
		idpSnapshot: ctx.idp,
		startedAt,
		finishedAt: startedAt,
		status,
		navigations: [],
		exchanges: [],
		failures: [],
		validations: []
	};
}

function setup(execute: (ctx: RunContext) => Promise<Run>) {
	const ipc = createMemoryIpc();
	const repo = new WorkspaceRepository(ipc);
	const runner = new RunnerStore({
		ipc,
		repo,
		execute,
		userInfo: () => Promise.resolve({}),
		appVersion: '0.0.0'
	});
	const idp = newIdp('Fake');
	const flow = newFlow('client_credentials');
	const client = newClient('Fake client');
	client.flows.push(flow);
	idp.clients.push(client);
	return { ipc, repo, runner, idp, client, flow };
}

describe('RunnerStore', () => {
	it('REQ-FLOW-012 a second start while a run is active is refused; cancel aborts the active run', async () => {
		let release: (run: Run) => void = () => {};
		let seen: RunContext | null = null;
		const { runner, idp, client, flow } = setup(
			(ctx) =>
				new Promise<Run>((resolve) => {
					seen = ctx;
					release = (run) => resolve(run);
					ctx.signal.addEventListener('abort', () => resolve(runFor(ctx, 'cancelled')));
				})
		);

		const first = runner.start('ws1', idp, client, flow);
		expect(runner.running).toBe(true);
		expect(await runner.start('ws1', idp, client, flow)).toBeNull();

		runner.cancel();
		const run = await first;
		expect(seen!.signal.aborted).toBe(true);
		expect(run?.status).toBe('cancelled');
		expect(runner.running).toBe(false);
		release(run!);
	});

	it('REQ-TL-007 a finished run is persisted and becomes the shown run, newest first in history', async () => {
		let n = 0;
		const { repo, runner, idp, client, flow } = setup((ctx) =>
			Promise.resolve(runFor(ctx, 'success', `2026-10-02T10:0${n++}:00.000Z`))
		);
		const a = await runner.start('ws1', idp, client, flow);
		const b = await runner.start('ws1', idp, client, flow);

		expect(runner.shown?.id).toBe(b?.id);
		expect(runner.runs.map((r) => r.id)).toEqual([b!.id, a!.id]);
		expect((await repo.listRuns('ws1')).map((r) => r.id).sort()).toEqual([a!.id, b!.id].sort());
	});

	it('REQ-TL-006 removing a run deletes it from storage and history', async () => {
		const { repo, runner, idp, client, flow } = setup((ctx) =>
			Promise.resolve(runFor(ctx, 'error'))
		);
		const run = await runner.start('ws1', idp, client, flow);
		await runner.remove('ws1', run!.id);
		expect(runner.runs).toEqual([]);
		expect(runner.shown).toBeNull();
		expect(await repo.listRuns('ws1')).toEqual([]);
	});
});
