// Spec <-> test traceability check. Run: `pnpm spec:check [--areas=HTTP,STORE]`.
// Erasable TypeScript only (Node runs this file directly via type stripping).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SpecId {
	id: string;
	area: string;
	file: string;
}

export interface CoverageResult {
	total: number;
	covered: number;
	uncovered: string[];
}

const HEADING = /^###\s+(REQ-([A-Z][A-Z0-9]*)-\d{3})\b/;
const SKIP_DIRS = new Set(['node_modules', 'target', '.svelte-kit', 'build', '.git', 'gen']);

function walk(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIRS.has(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
}

/** REQ headings in specs/*.md that are not marked `Status: Removed`. */
export function collectSpecIds(root: string): SpecId[] {
	const specsDir = join(root, 'specs');
	if (!existsSync(specsDir)) return [];
	const ids: SpecId[] = [];
	for (const name of readdirSync(specsDir).sort()) {
		if (!name.endsWith('.md')) continue;
		const lines = readFileSync(join(specsDir, name), 'utf8').split(/\r?\n/);
		let current: SpecId | null = null;
		let removed = false;
		const flush = () => {
			if (current && !removed) ids.push(current);
		};
		for (const line of lines) {
			const m = HEADING.exec(line);
			if (m) {
				flush();
				current = { id: m[1], area: m[2], file: name };
				removed = false;
			} else if (current && /^Status:\s*Removed\b/.test(line)) {
				removed = true;
			}
		}
		flush();
	}
	return ids;
}

function posix(root: string, file: string): string {
	return relative(root, file).split(sep).join('/');
}

function isTestSource(rel: string): boolean {
	if (rel.startsWith('src/')) return /\.(test\.ts|stories\.svelte|stories\.ts)$/.test(rel);
	if (rel.startsWith('src-tauri/src/')) return rel.endsWith('.rs');
	if (rel.startsWith('e2e/')) return rel.endsWith('.spec.ts');
	if (rel.startsWith('tests/') || rel.startsWith('scripts/')) return rel.endsWith('.test.ts');
	return false;
}

function mentions(file: string, text: string, id: string): boolean {
	if (file.endsWith('.rs')) {
		const fnName = id.toLowerCase().replaceAll('-', '_');
		return new RegExp(`\\bfn\\s+${fnName}(?!\\d)`).test(text);
	}
	return new RegExp(`(?<![A-Za-z0-9-])${id}(?!\\d)`).test(text);
}

export function checkCoverage(opts: { root: string; areas?: string[] }): CoverageResult {
	const { root, areas } = opts;
	const wanted = areas && areas.length ? new Set(areas.map((a) => a.toUpperCase())) : null;
	const ids = collectSpecIds(root).filter((s) => !wanted || wanted.has(s.area));
	const sources = walk(root)
		.filter((f) => isTestSource(posix(root, f)))
		.map((f) => ({ file: f, text: readFileSync(f, 'utf8') }));
	const uncovered = ids
		.filter((s) => !sources.some((src) => mentions(src.file, src.text, s.id)))
		.map((s) => s.id);
	return { total: ids.length, covered: ids.length - uncovered.length, uncovered };
}

function main(argv: string[]) {
	const areasArg = argv.find((a) => a.startsWith('--areas='));
	const areas = areasArg ? areasArg.slice('--areas='.length).split(',').filter(Boolean) : undefined;
	const result = checkCoverage({ root: process.cwd(), areas });
	if (result.uncovered.length) {
		console.log('Uncovered requirements:');
		for (const id of result.uncovered) console.log(`  ${id}`);
	}
	console.log(`spec coverage: ${result.covered}/${result.total}`);
	process.exitCode = result.uncovered.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main(process.argv.slice(2));
}
