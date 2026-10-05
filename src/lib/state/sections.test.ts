import { describe, expect, it } from 'vitest';
import { SECTIONS_STORAGE_KEY, SectionMemory } from './sections.svelte';

function fakeStorage(initial?: string) {
	const data = new Map<string, string>();
	if (initial !== undefined) data.set(SECTIONS_STORAGE_KEY, initial);
	return {
		data,
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value)
	};
}

describe('SectionMemory', () => {
	it('REQ-UI-014 section memory survives invalid storage and persists toggles', () => {
		for (const bad of ['{not json', '[true]', '"open"', 'null', '{"a":"yes","b":1}']) {
			expect(new SectionMemory(fakeStorage(bad)).isOpen('a', true)).toBe(true);
			expect(new SectionMemory(fakeStorage(bad)).isOpen('a', false)).toBe(false);
		}

		const storage = fakeStorage();
		const memory = new SectionMemory(storage);
		expect(memory.isOpen('idp.network', false)).toBe(false);
		memory.set('idp.network', true);
		memory.set('flow.advanced', false);
		expect(memory.isOpen('idp.network', false)).toBe(true);
		expect(JSON.parse(storage.data.get(SECTIONS_STORAGE_KEY) ?? '')).toEqual({
			'idp.network': true,
			'flow.advanced': false
		});

		const reloaded = new SectionMemory(storage);
		expect(reloaded.isOpen('idp.network', false)).toBe(true);
		expect(reloaded.isOpen('flow.advanced', true)).toBe(false);
	});
});
