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

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

function tokenBlock(css: string, selector: string): string {
	const start = css.indexOf(`${selector} {`);
	return css.slice(start, css.indexOf('}', start));
}

function token(block: string, name: string): string {
	const match = block.match(new RegExp(`--c-${name}:\\s*(#[0-9a-f]{6})`, 'i'));
	if (!match) throw new Error(`--c-${name} not found`);
	return match[1].toLowerCase();
}

describe('accent tokens', () => {
	it('REQ-UI-022 accent-fg on accent meets 4.5:1 in light and dark', () => {
		const css = readFileSync('src/app.css', 'utf8');
		const light = tokenBlock(css, ':root');
		const dark = tokenBlock(css, '.dark');
		expect(token(light, 'accent')).toBe('#4338ca');
		expect(token(dark, 'accent')).toBe('#a5b4fc');
		expect(token(light, 'focus')).toBe(token(light, 'accent'));
		expect(token(dark, 'focus')).toBe(token(dark, 'accent'));
		expect(contrast(token(light, 'accent-fg'), token(light, 'accent'))).toBeGreaterThanOrEqual(4.5);
		expect(contrast(token(dark, 'accent-fg'), token(dark, 'accent'))).toBeGreaterThanOrEqual(4.5);
	});
});
