import type { Header, HttpExchange } from '#lib/ipc/types.js';
import type { Run } from '#lib/model/run.js';

export type TimelineEntry =
	{ type: 'nav'; at: string; url: string } | { type: 'http'; at: string; exchange: HttpExchange };

export type TimelineFilter = 'all' | 'nav' | 'http';

export interface FormRow {
	name: string;
	value: string;
}

export type FormattedBody =
	| { kind: 'empty' }
	| { kind: 'json'; text: string }
	| { kind: 'form'; rows: FormRow[] }
	| { kind: 'text'; text: string };

/** REQ-TL-001: navigations and exchanges in chronological order (stable; navigations first on ties). */
export function buildTimeline(run: Run): TimelineEntry[] {
	const entries: TimelineEntry[] = [
		...run.navigations.map((n): TimelineEntry => ({ type: 'nav', at: n.at, url: n.url })),
		...run.exchanges.map((exchange): TimelineEntry => ({
			type: 'http',
			at: exchange.startedAt,
			exchange
		}))
	];
	return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function filterEntries(entries: TimelineEntry[], filter: TimelineFilter): TimelineEntry[] {
	return filter === 'all' ? entries : entries.filter((e) => e.type === filter);
}

/** REQ-TL-002: JSON pretty-printed, form bodies as name/value rows, anything else verbatim. */
export function formatBody(body: string | null, headers: Header[]): FormattedBody {
	if (body === null || body === '') return { kind: 'empty' };
	const type =
		headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1].toLowerCase() ?? '';
	if (type.includes('json') || /^\s*[{[]/.test(body)) {
		try {
			return { kind: 'json', text: JSON.stringify(JSON.parse(body), null, 2) };
		} catch {
			return { kind: 'text', text: body };
		}
	}
	if (type.includes('application/x-www-form-urlencoded')) {
		const rows = [...new URLSearchParams(body)].map(([name, value]) => ({ name, value }));
		return { kind: 'form', rows };
	}
	return { kind: 'text', text: body };
}
