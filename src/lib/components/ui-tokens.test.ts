import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PALETTE = /\b(bg|text|border)-(gray|slate|zinc|neutral|red|green|blue)-\d{2,3}\b/g;
const ROOTS = ['src/lib/components', 'src/routes'];

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return svelteFiles(full);
		return entry.name.endsWith('.svelte') ? [full] : [];
	});
}

describe('semantic color tokens', () => {
	it('REQ-UI-003 the palette pattern flags raw palette classes', () => {
		const hits = 'class="bg-gray-800 text-red-500 border-blue-300 bg-surface text-fg"'.match(
			PALETTE
		);
		expect(hits).toEqual(['bg-gray-800', 'text-red-500', 'border-blue-300']);
	});

	it('REQ-UI-003 no .svelte file uses raw palette colors', () => {
		const offenders: string[] = [];
		for (const file of ROOTS.flatMap(svelteFiles)) {
			const hits = readFileSync(file, 'utf8').match(PALETTE);
			if (hits) offenders.push(`${file}: ${hits.join(', ')}`);
		}
		expect(offenders).toEqual([]);
	});
});
