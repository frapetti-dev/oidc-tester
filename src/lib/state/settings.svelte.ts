import type { IpcApi } from '#lib/ipc/types.js';
import { SETTINGS_DOC, SettingsSchema, newSettings, type Settings } from '#lib/model/settings.js';
import { describeZodError } from '#lib/model/workspaceFile.js';
import { createDebouncedSaver, type DebouncedSaver } from './autosave';

export const SETTINGS_SAVE_DELAY_MS = 500;

/** App-wide settings persisted in `settings.json`; written only after a change (REQ-SET-001). */
export class SettingsStore {
	current = $state<Settings>(newSettings());
	/** Set when `settings.json` failed validation; the file is left alone until the next change. */
	error = $state<string | null>(null);

	private readonly ipc: IpcApi;
	private readonly saver: DebouncedSaver<Settings>;

	constructor(ipc: IpcApi) {
		this.ipc = ipc;
		this.saver = createDebouncedSaver(
			(value) => this.ipc.docWrite(SETTINGS_DOC, value),
			SETTINGS_SAVE_DELAY_MS
		);
	}

	async load(): Promise<void> {
		const raw = await this.ipc.docRead(SETTINGS_DOC);
		if (raw === null) return;
		const parsed = SettingsSchema.safeParse(raw);
		if (parsed.success) {
			this.current = parsed.data;
			this.error = null;
		} else {
			this.error = `Settings file is invalid: ${describeZodError(parsed.error)}. Defaults are in use.`;
		}
	}

	update(mutate: (settings: Settings) => void): void {
		mutate(this.current);
		this.saver.schedule($state.snapshot(this.current));
	}

	replace(next: Settings): void {
		this.current = structuredClone(next);
		this.saver.schedule($state.snapshot(this.current));
	}

	flush(): Promise<void> {
		return this.saver.flush();
	}

	dispose(): void {
		this.saver.cancel();
	}
}
