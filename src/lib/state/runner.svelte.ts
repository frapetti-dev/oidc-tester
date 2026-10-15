import type { IpcApi } from '#lib/ipc/types.js';
import type { RunError, Run } from '#lib/model/run.js';
import type { Client, Flow, Idp } from '#lib/model/schema.js';
import type { DeviceUserCode } from '#lib/oauth/device.js';
import type { callUserInfo, executeRun, RunContext } from '#lib/run/engine.js';
import type { WorkspaceRepository } from './repository';

export interface RunnerDeps {
	ipc: IpcApi;
	repo: WorkspaceRepository;
	execute: typeof executeRun;
	userInfo: typeof callUserInfo;
	appVersion: string;
}

/** Runs flows one at a time and keeps the run history of the open workspace. */
export class RunnerStore {
	running = $state(false);
	deviceCode = $state<DeviceUserCode | null>(null);
	/** Run shown in the results panel. */
	shown = $state<Run | null>(null);
	/** Runs of the open workspace, newest first. */
	runs = $state<Run[]>([]);
	userinfo = $state<unknown>(null);
	/** Error from IdP discovery; shown in the Errors tab when no run error exists. */
	discoveryError = $state<RunError | null>(null);

	private readonly deps: RunnerDeps;
	private controller: AbortController | null = null;

	constructor(deps: RunnerDeps) {
		this.deps = deps;
	}

	/** Starts a run; returns null when one is already active. */
	async start(workspaceId: string, idp: Idp, client: Client, flow: Flow): Promise<Run | null> {
		if (this.running) return null;
		this.running = true;
		this.userinfo = null;
		this.discoveryError = null;
		const controller = new AbortController();
		this.controller = controller;
		const ctx: RunContext = {
			ipc: this.deps.ipc,
			workspaceId,
			idp: $state.snapshot(idp) as Idp,
			client: $state.snapshot(client) as Client,
			flow: $state.snapshot(flow) as Flow,
			signal: controller.signal,
			appVersion: this.deps.appVersion,
			onDeviceCode: (info) => (this.deviceCode = info),
			onProgress: (run) => (this.shown = run)
		};
		try {
			const run = await this.deps.execute(ctx);
			await this.deps.repo.saveRun(run);
			this.shown = run;
			this.runs = [run, ...this.runs.filter((r) => r.id !== run.id)];
			return run;
		} finally {
			this.running = false;
			this.deviceCode = null;
			this.controller = null;
		}
	}

	cancel(): void {
		this.controller?.abort();
	}

	async loadRuns(workspaceId: string): Promise<void> {
		this.runs = await this.deps.repo.listRuns(workspaceId);
		this.shown = this.runs[0] ?? null;
		this.userinfo = null;
	}

	select(runId: string): void {
		this.shown = this.runs.find((r) => r.id === runId) ?? this.shown;
		this.userinfo = null;
	}

	async remove(workspaceId: string, runId: string): Promise<void> {
		await this.deps.repo.deleteRun(workspaceId, runId);
		this.runs = this.runs.filter((r) => r.id !== runId);
		if (this.shown?.id === runId) this.shown = this.runs[0] ?? null;
	}

	/** Calls the UserInfo endpoint with the shown run's access token. */
	async fetchUserInfo(): Promise<void> {
		const run = this.shown;
		const accessToken = run?.tokens?.access_token;
		if (!run || !accessToken) return;
		const result = await this.deps.userInfo(
			{ ipc: this.deps.ipc, idp: run.idpSnapshot, flow: run.flowSnapshot },
			accessToken
		);
		this.userinfo = result.error ?? result.body ?? null;
	}
}
