import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkCoverage, collectSpecIds } from './spec-coverage.ts';

const here = dirname(fileURLToPath(import.meta.url));
let root: string;

function put(rel: string, contents: string) {
	const full = join(root, rel);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, contents);
}

function spec(id: string, status = 'Accepted') {
	return `### ${id} Title\n\nStatus: ${status}\n\nGiven x\nWhen y\nThen z\n\n`;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'spec-cov-'));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('spec-coverage', () => {
	it('REQ-TOOL-001 collects IDs from spec headings, including digit-bearing areas, and skips Removed', () => {
		put(
			'specs/a.md',
			'# A\n\n' + spec('REQ-FAKEA-001') + spec('REQ-FAKE2-001') + spec('REQ-FAKEA-002', 'Removed')
		);
		put('specs/README.md', '# Specs\n\nExample: ### REQ-AREA-999 not a heading\n');
		expect(collectSpecIds(root).map((s) => s.id)).toEqual(['REQ-FAKEA-001', 'REQ-FAKE2-001']);
	});

	it('REQ-TOOL-002 reports uncovered IDs and covered IDs from test, story, spec and Rust files', () => {
		put(
			'specs/a.md',
			spec('REQ-FAKEA-001') +
				spec('REQ-FAKEB-003') +
				spec('REQ-FAKEC-004') +
				spec('REQ-FAKE2-001') +
				spec('REQ-FAKED-001')
		);
		put('src/lib/pkce.test.ts', "it('REQ-FAKEA-001 verifier', () => {});");
		put('src-tauri/src/http.rs', '#[test] fn req_fakeb_003_tls() {}');
		put('src/lib/Button.stories.svelte', "<Story name='REQ-FAKEC-004 button' />");
		put('e2e/web/flow.spec.ts', "test('REQ-FAKE2-001 happy path', () => {});");
		const result = checkCoverage({ root });
		expect(result.total).toBe(5);
		expect(result.covered).toBe(4);
		expect(result.uncovered).toEqual(['REQ-FAKED-001']);
	});

	it('REQ-TOOL-003 ignores IDs mentioned in files that are not test sources', () => {
		put('specs/a.md', spec('REQ-FAKEA-001'));
		put('src/lib/pkce.ts', '// REQ-FAKEA-001 implemented here');
		put('src-tauri/src/lib.rs', '// no test attribute but mentions req_pkce_001');
		put('docs/notes.md', 'REQ-FAKEA-001');
		expect(checkCoverage({ root }).uncovered).toEqual(['REQ-FAKEA-001']);
	});

	it('REQ-TOOL-004 does not let REQ-X-001 match inside REQ-X-0010 style longer tokens', () => {
		put('specs/a.md', spec('REQ-FAKEA-001'));
		put('src/lib/pkce.test.ts', "it('REQ-FAKEA-0012 other', () => {});");
		expect(checkCoverage({ root }).uncovered).toEqual(['REQ-FAKEA-001']);
	});

	it('REQ-TOOL-005 restricts to the requested areas', () => {
		put('specs/a.md', spec('REQ-FAKEA-001') + spec('REQ-FAKEB-001'));
		put('src/lib/pkce.test.ts', "it('REQ-FAKEA-001 v', () => {});");
		const result = checkCoverage({ root, areas: ['FAKEA'] });
		expect(result).toMatchObject({ total: 1, covered: 1, uncovered: [] });
	});

	it('REQ-TOOL-006 CLI prints N/N and exits 0 when covered, exits 1 listing uncovered otherwise', () => {
		put('specs/a.md', spec('REQ-FAKEA-001') + spec('REQ-FAKEB-001'));
		put('src/lib/pkce.test.ts', "it('REQ-FAKEA-001 v', () => {});");
		const script = join(here, 'spec-coverage.ts');
		const fail = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
		expect(fail.status).toBe(1);
		expect(fail.stdout + fail.stderr).toContain('REQ-FAKEB-001');
		expect(fail.stdout).toContain('spec coverage: 1/2');
		const ok = spawnSync(process.execPath, [script, '--areas=FAKEA'], {
			cwd: root,
			encoding: 'utf8'
		});
		expect(ok.status).toBe(0);
		expect(ok.stdout).toContain('spec coverage: 1/1');
	});
});
