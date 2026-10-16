import { describe, expect, it } from 'vitest';
import { tokenizeJson } from './jsonTokens.js';

const SAMPLE = '{\n  "a": "x",\n  "n": -1.5e3,\n  "b": [true, null]\n}';

describe('tokenizeJson', () => {
	it('REQ-UI-023 classifies keys, strings, numbers, literals and punctuation', () => {
		const tokens = tokenizeJson(SAMPLE)
			.filter((t) => t.kind !== 'space')
			.map((t) => [t.kind, t.text]);
		expect(tokens).toEqual([
			['punct', '{'],
			['key', '"a"'],
			['punct', ':'],
			['string', '"x"'],
			['punct', ','],
			['key', '"n"'],
			['punct', ':'],
			['number', '-1.5e3'],
			['punct', ','],
			['key', '"b"'],
			['punct', ':'],
			['punct', '['],
			['literal', 'true'],
			['punct', ','],
			['literal', 'null'],
			['punct', ']'],
			['punct', '}']
		]);
	});

	it('REQ-UI-023 string containing escaped quote and colon stays one string token', () => {
		const tokens = tokenizeJson('{"k": "a\\": b"}').filter((t) => t.kind !== 'space');
		expect(tokens[3]).toEqual({ kind: 'string', text: '"a\\": b"' });
	});

	it('REQ-UI-023 token texts concatenate to the input', () => {
		for (const input of [SAMPLE, '{bad']) {
			expect(
				tokenizeJson(input)
					.map((t) => t.text)
					.join('')
			).toBe(input);
		}
	});
});
