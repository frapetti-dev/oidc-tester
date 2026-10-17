import { describe, expect, it } from 'vitest';
import { fromCargo, fromPnpm, mergeLicenses } from './licenses.ts';

const pkg = (name: string, license?: string, extra: Record<string, unknown> = {}) => ({
	id: `${name} 1.0.0`,
	name,
	version: '1.0.0',
	license: license ?? null,
	homepage: null,
	repository: null,
	...extra
});

describe('REQ-TOOL-007 license list', () => {
	it('REQ-TOOL-007 pnpm entries expand one per version, falling back to the license key', () => {
		const out = fromPnpm({
			MIT: [
				{ name: 'a', versions: ['1.0.0', '2.0.0'], license: 'MIT', homepage: 'https://a.dev' },
				{ name: 'b', versions: ['3.0.0'] }
			]
		});
		expect(out).toEqual([
			{ name: 'a', version: '1.0.0', license: 'MIT', source: 'npm', homepage: 'https://a.dev' },
			{ name: 'a', version: '2.0.0', license: 'MIT', source: 'npm', homepage: 'https://a.dev' },
			{ name: 'b', version: '3.0.0', license: 'MIT', source: 'npm', homepage: null }
		]);
	});

	it('REQ-TOOL-007 cargo walk keeps normal deps only and excludes the root', () => {
		const meta = {
			packages: [
				pkg('root', 'MIT'),
				pkg('normal', 'Apache-2.0', { repository: 'https://r.dev' }),
				pkg('devonly', 'MIT'),
				pkg('buildonly', 'MIT'),
				pkg('nolicense'),
				pkg('transitive', 'MIT', { homepage: 'https://t.dev' })
			],
			resolve: {
				root: 'root 1.0.0',
				nodes: [
					{
						id: 'root 1.0.0',
						deps: [
							{ pkg: 'normal 1.0.0', dep_kinds: [{ kind: null }] },
							{ pkg: 'devonly 1.0.0', dep_kinds: [{ kind: 'dev' }] },
							{ pkg: 'buildonly 1.0.0', dep_kinds: [{ kind: 'build' }] },
							{ pkg: 'nolicense 1.0.0', dep_kinds: [{ kind: 'build' }, { kind: null }] }
						]
					},
					{ id: 'normal 1.0.0', deps: [{ pkg: 'transitive 1.0.0', dep_kinds: [{ kind: null }] }] },
					{ id: 'transitive 1.0.0', deps: [] },
					{ id: 'nolicense 1.0.0', deps: [] },
					{ id: 'devonly 1.0.0', deps: [] },
					{ id: 'buildonly 1.0.0', deps: [] }
				]
			}
		};
		const out = fromCargo(meta, 'root');
		expect(out.map((e) => e.name).sort()).toEqual(['nolicense', 'normal', 'transitive']);
		expect(out.find((e) => e.name === 'nolicense')?.license).toBe('UNKNOWN');
		expect(out.find((e) => e.name === 'normal')?.homepage).toBe('https://r.dev');
		expect(out.find((e) => e.name === 'transitive')?.homepage).toBe('https://t.dev');
		expect(out.every((e) => e.source === 'cargo')).toBe(true);
	});

	it('REQ-TOOL-007 merge sorts by name then version and dedupes by source+name+version', () => {
		const e = (name: string, version: string, source: 'npm' | 'cargo' = 'npm') => ({
			name,
			version,
			license: 'MIT',
			source,
			homepage: null
		});
		const out = mergeLicenses(
			[e('b', '1'), e('a', '2'), e('a', '1')],
			[e('a', '1'), e('a', '1', 'cargo')]
		);
		expect(out.map((x) => `${x.source}:${x.name}@${x.version}`)).toEqual([
			'cargo:a@1',
			'npm:a@1',
			'npm:a@2',
			'npm:b@1'
		]);
	});
});
