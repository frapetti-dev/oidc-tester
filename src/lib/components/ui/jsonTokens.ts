export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'space';
export interface JsonToken {
	kind: JsonTokenKind;
	text: string;
}

const KINDS: readonly JsonTokenKind[] = ['key', 'string', 'number', 'literal', 'punct', 'space'];

const TOKEN =
	/("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],:])|(\s+)/y;

/** REQ-UI-023: splits JSON text into tokens; concatenating `text` of all tokens yields the input. */
export function tokenizeJson(source: string): JsonToken[] {
	const tokens: JsonToken[] = [];
	TOKEN.lastIndex = 0;
	let i = 0;
	while (i < source.length) {
		TOKEN.lastIndex = i;
		const match = TOKEN.exec(source);
		if (match) {
			const group = match.findIndex((g, idx) => idx > 0 && g !== undefined) - 1;
			tokens.push({ kind: KINDS[group], text: match[0] });
			i += match[0].length;
		} else {
			// Malformed input: keep the concatenation invariant by emitting one code point.
			const cp = String.fromCodePoint(source.codePointAt(i)!);
			tokens.push({ kind: 'punct', text: cp });
			i += cp.length;
		}
	}
	return tokens;
}
