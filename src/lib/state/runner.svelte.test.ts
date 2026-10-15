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
	const other = newFlow('client_credentials');
	const client = newClient('Fake client');
	client.flows.push(flow, other);
	idp.clients.push(client);
	return { ipc, repo, runner, idp, client, flow, other };
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
		runner.showFlow(flow.id);
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
		runner.showFlow(flow.id);
		const run = await runner.start('ws1', idp, client, flow);
		await runner.remove('ws1', run!.id);
		expect(runner.runs).toEqual([]);
		expect(runner.shown).toBeNull();
		expect(await repo.listRuns('ws1')).toEqual([]);
	});

	it('REQ-UI-020 shown run follows the selected flow and remembers the run opened from history', async () => {
		let n = 0;
		const { runner, idp, client, flow, other } = setup((ctx) =>
			Promise.resolve(runFor(ctx, 'success', `2026-10-02T10:0${n++}:00.000Z`))
		);
		runner.showFlow(flow.id);
		const a = await runner.start('ws1', idp, client, flow);
		const b = await runner.start('ws1', idp, client, flow);

		runner.showFlow(other.id);
		expect(runner.shown).toBeNull();
		runner.showFlow(flow.id);
		expect(runner.shown?.id).toBe(b!.id);

		runner.select(a!.id);
		runner.showFlow(other.id);
		runner.showFlow(flow.id);
		expect(runner.shown?.id).toBe(a!.id);

		const c = await runner.start('ws1', idp, client, flow);
		expect(runner.shown?.id).toBe(c!.id);
	});

	it('REQ-UI-020 an in-progress run is shown only while its flow is selected', async () => {
		let release: (run: Run) => void = () => {};
		let partial: Run | null = null;
		let finished: Run | null = null;
		const { runner, idp, client, flow, other } = setup(
			(ctx) =>
				new Promise<Run>((resolve) => {
					partial = runFor(ctx, 'success');
					finished = runFor(ctx, 'success');
					ctx.onProgress?.(partial);
					release = () => resolve(finished!);
				})
		);
		runner.showFlow(flow.id);
		const started = runner.start('ws1', idp, client, flow);
		expect(runner.shown?.id).toBe(partial!.id);
		runner.showFlow(other.id);
		expect(runner.shown).toBeNull();
		runner.showFlow(flow.id);
		expect(runner.shown?.id).toBe(partial!.id);

		release(finished!);
		await started;
		expect(runner.shown?.id).toBe(finished!.id);
	});
});
