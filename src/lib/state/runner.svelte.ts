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
	/** Flow selected in the sidebar; the results panel shows its runs. */
	flowId = $state<string | null>(null);
	/** Run shown in the results panel. */
	shown = $derived.by((): Run | null => {
		if (this.active && this.active.flowId === this.flowId) return this.active;
		if (this.override) {
			const opened = this.runs.find((r) => r.id === this.override);
			if (opened) return opened;
		}
		if (!this.flowId) return null;
		const pickedId = this.picked[this.flowId];
		return (
			this.runs.find((r) => r.id === pickedId) ??
			this.runs.find((r) => r.flowId === this.flowId) ??
			null
		);
	});
	/** Runs of the open workspace, newest first. */
	runs = $state<Run[]>([]);
	userinfo = $state<unknown>(null);
	/** Error from IdP discovery; shown in the Errors tab when no run error exists. */
	discoveryError = $state<RunError | null>(null);

	private readonly deps: RunnerDeps;
	private controller: AbortController | null = null;
	/** In-progress run, reported by the engine. */
	private active = $state<Run | null>(null);
	/** flowId → runId opened from History. */
	private picked = $state<Record<string, string>>({});
	/** Run opened from History whose flow no longer exists. */
	private override = $state<string | null>(null);

	constructor(deps: RunnerDeps) {
		this.deps = deps;
	}

	/** Starts a run; returns null when one is already active. */
	async start(workspaceId: string, idp: Idp, client: Client, flow: Flow): Promise<Run | null> {
		if (this.running) return null;
		this.running = true;
		this.override = null;
		delete this.picked[flow.id];
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
			onProgress: (run) => (this.active = run)
		};
		try {
			const run = await this.deps.execute(ctx);
			await this.deps.repo.saveRun(run);
			// The finished run is prepended to `runs` below; `shown` derives from it.
			this.runs = [run, ...this.runs.filter((r) => r.id !== run.id)];
			return run;
		} finally {
			this.running = false;
			this.active = null;
			this.deviceCode = null;
			this.controller = null;
		}
	}

	cancel(): void {
		this.controller?.abort();
	}

	/** Selects the flow whose runs the results panel shows. */
	showFlow(flowId: string | null): void {
		if (flowId === this.flowId) return;
		this.flowId = flowId;
		this.override = null;
		this.userinfo = null;
	}

	async loadRuns(workspaceId: string): Promise<void> {
		this.runs = await this.deps.repo.listRuns(workspaceId);
		this.picked = {};
		this.override = null;
		this.userinfo = null;
	}

	select(runId: string): void {
		const run = this.runs.find((r) => r.id === runId);
		if (!run) return;
		this.picked[run.flowId] = run.id;
		this.override = run.flowId === this.flowId ? null : run.id;
		this.userinfo = null;
	}

	async remove(workspaceId: string, runId: string): Promise<void> {
		await this.deps.repo.deleteRun(workspaceId, runId);
		this.runs = this.runs.filter((r) => r.id !== runId);
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
