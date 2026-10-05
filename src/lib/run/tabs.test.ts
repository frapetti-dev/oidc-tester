import { describe, expect, it } from 'vitest';
import type { Run } from '#lib/model/run.js';
import { tabForRun } from './tabs';

function run(status: Run['status'], error?: Run['error']): Pick<Run, 'status' | 'error'> {
	return { status, error };
}

describe('tabForRun', () => {
	it('REQ-ERR-003 a run with an error selects the Errors tab', () => {
		expect(tabForRun(run('error', { source: 'token', error: 'invalid_grant' }))).toBe('errors');
	});

	it('REQ-ERR-003 an error status without error details still selects the Errors tab', () => {
		expect(tabForRun(run('error'))).toBe('errors');
	});

	it('REQ-ERR-003 a successful run selects the Tokens tab', () => {
		expect(tabForRun(run('success'))).toBe('tokens');
	});

	it('REQ-ERR-003 a cancelled run or no run leaves the tab unchanged', () => {
		expect(tabForRun(run('cancelled'))).toBeNull();
		expect(tabForRun(null)).toBeNull();
	});
});
