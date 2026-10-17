import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LicenseEntry } from '../src/lib/about/about.ts';

type PnpmLicenses = Record<
	string,
	Array<{ name: string; versions: string[]; license?: string; homepage?: string }>
>;

export interface CargoMetadata {
	packages: Array<{
		id: string;
		name: string;
		version: string;
		license: string | null;
		homepage: string | null;
		repository: string | null;
	}>;
	resolve: {
		root: string | null;
		nodes: Array<{
			id: string;
			deps: Array<{ pkg: string; dep_kinds: Array<{ kind: string | null }> }>;
		}>;
	};
}

export function fromPnpm(json: PnpmLicenses): LicenseEntry[] {
	const out: LicenseEntry[] = [];
	for (const [licenseKey, pkgs] of Object.entries(json)) {
		for (const p of pkgs) {
			for (const version of p.versions) {
				out.push({
					name: p.name,
					version,
					license: p.license ?? licenseKey ?? 'UNKNOWN',
					source: 'npm',
					homepage: p.homepage ?? null
				});
			}
		}
	}
	return out;
}

export function fromCargo(meta: CargoMetadata, rootName: string): LicenseEntry[] {
	const byId = new Map(meta.packages.map((p) => [p.id, p]));
	const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
	const rootId = meta.resolve.root;
	if (!rootId) throw new Error('cargo metadata has no resolve root');
	const seen = new Set<string>([rootId]);
	const stack = [rootId];
	while (stack.length) {
		const node = nodes.get(stack.pop()!);
		for (const dep of node?.deps ?? []) {
			if (!dep.dep_kinds.some((k) => k.kind === null) || seen.has(dep.pkg)) continue;
			seen.add(dep.pkg);
			stack.push(dep.pkg);
		}
	}
	const out: LicenseEntry[] = [];
	for (const id of seen) {
		const p = byId.get(id);
		if (!p || p.name === rootName) continue;
		out.push({
			name: p.name,
			version: p.version,
			license: p.license ?? 'UNKNOWN',
			source: 'cargo',
			homepage: p.homepage ?? p.repository ?? null
		});
	}
	return out;
}

export function mergeLicenses(a: LicenseEntry[], b: LicenseEntry[]): LicenseEntry[] {
	const unique = new Map<string, LicenseEntry>();
	for (const e of [...a, ...b]) {
		const key = `${e.source}\0${e.name}\0${e.version}`;
		if (!unique.has(key)) unique.set(key, e);
	}
	return [...unique.values()].sort(
		(x, y) =>
			(x.name < y.name ? -1 : x.name > y.name ? 1 : 0) ||
			(x.version < y.version ? -1 : x.version > y.version ? 1 : 0) ||
			(x.source < y.source ? -1 : x.source > y.source ? 1 : 0)
	);
}

function main() {
	const opts = { shell: true, encoding: 'utf8', maxBuffer: 64 << 20 } as const;
	const env = { ...process.env };
	if (process.platform === 'win32' && process.env.USERPROFILE) {
		const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
		env[pathKey] =
			join(process.env.USERPROFILE, '.cargo', 'bin') + delimiter + (env[pathKey] ?? '');
	}
	const pnpm = JSON.parse(
		execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { ...opts, env })
	) as PnpmLicenses;
	const cargo = JSON.parse(
		execFileSync(
			'cargo',
			[
				'metadata',
				'--format-version',
				'1',
				'--manifest-path',
				'src-tauri/Cargo.toml',
				'--filter-platform',
				'x86_64-pc-windows-msvc'
			],
			{ ...opts, env }
		)
	) as CargoMetadata;
	const packages = mergeLicenses(fromPnpm(pnpm), fromCargo(cargo, 'oidc-tester'));
	writeFileSync('src/lib/about/licenses.json', JSON.stringify({ packages }, null, '\t') + '\n');
	console.log(`licenses: ${packages.length} packages`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main();
}
