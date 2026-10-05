export const SECTIONS_STORAGE_KEY = 'oidct.sections';

type SectionStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Only plain objects with boolean values survive; anything else (including bad JSON) is `{}`. */
function parse(raw: string | null): Record<string, boolean> {
	if (raw === null) return {};
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
		return Object.fromEntries(
			Object.entries(value).filter(
				(entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
			)
		);
	} catch {
		return {};
	}
}

/** Open/closed state of form sections, persisted as `{ [sectionId]: boolean }`. REQ-UI-014 */
export class SectionMemory {
	private readonly storage: SectionStorage | null;
	private open = $state<Record<string, boolean>>({});

	constructor(storage: SectionStorage | null) {
		this.storage = storage;
		this.open = parse(storage?.getItem(SECTIONS_STORAGE_KEY) ?? null);
	}

	isOpen(id: string, fallback: boolean): boolean {
		return this.open[id] ?? fallback;
	}

	set(id: string, open: boolean): void {
		this.open[id] = open;
		try {
			this.storage?.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(this.open));
		} catch {
			// Storage can be full or blocked; the in-memory state still applies.
		}
	}
}

let singleton: SectionMemory | null = null;

/** Shared instance over `window.localStorage`. */
export function sectionMemory(): SectionMemory {
	singleton ??= new SectionMemory(typeof window === 'undefined' ? null : window.localStorage);
	return singleton;
}

/** Drops the shared instance so the next `sectionMemory()` re-reads storage (test isolation). */
export function resetSectionMemory(): void {
	singleton = null;
}
