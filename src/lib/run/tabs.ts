import type { Run } from '$lib/model/run';

export type ResultTab = 'tokens' | 'errors';

/** REQ-ERR-003: tab to show when a run finishes; null leaves the current tab unchanged. */
export function tabForRun(run: Pick<Run, 'status' | 'error'> | null): ResultTab | null {
	if (!run) return null;
	if (run.error || run.status === 'error') return 'errors';
	if (run.status === 'success') return 'tokens';
	return null;
}
