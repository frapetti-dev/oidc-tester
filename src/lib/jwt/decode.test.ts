import { describe, expect, it } from 'vitest';
import { SignJWT, generateKeyPair } from 'jose';
import { inspectToken, prettyJson, splitTokenSegments } from './decode';

const enc = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

async function signedToken(): Promise<string> {
	const { privateKey } = await generateKeyPair('ES256');
	return new SignJWT({ sub: 'alice', aud: ['a', 'b'] })
		.setProtectedHeader({ alg: 'ES256', kid: 'k1', typ: 'JWT' })
		.setIssuedAt(1_700_000_000)
		.sign(privateKey);
}

describe('inspectToken', () => {
	it('REQ-JWT-001 three parts decode to a jws with header, payload, signature and parts', async () => {
		const token = await signedToken();
		const result = inspectToken(token);
		expect(result.kind).toBe('jws');
		if (result.kind !== 'jws') return;
		expect(result.header).toEqual({ alg: 'ES256', kid: 'k1', typ: 'JWT' });
		expect(result.payload).toMatchObject({ sub: 'alice', aud: ['a', 'b'], iat: 1_700_000_000 });
		expect(result.parts).toEqual(token.split('.'));
		expect(result.signature).toBe(token.split('.')[2]);
	});

	it('REQ-JWT-001 an unsecured token with empty signature is still a jws', () => {
		const token = `${enc({ alg: 'none' })}.${enc({ sub: 'x' })}.`;
		const result = inspectToken(token);
		expect(result).toMatchObject({ kind: 'jws', header: { alg: 'none' }, signature: '' });
	});

	it('REQ-JWT-001 five parts give a jwe with its header only', () => {
		const token = [enc({ alg: 'RSA-OAEP', enc: 'A256GCM' }), 'ek', 'iv', 'ct', 'tag'].join('.');
		expect(inspectToken(token)).toEqual({
			kind: 'jwe',
			header: { alg: 'RSA-OAEP', enc: 'A256GCM' }
		});
	});

	it('REQ-JWT-001 strings without dots are opaque', () => {
		expect(inspectToken('2YotnFZFEjr1zCsicMWpAA')).toEqual({ kind: 'opaque' });
		expect(inspectToken('')).toEqual({ kind: 'opaque' });
		expect(inspectToken('not a token. with spaces')).toEqual({ kind: 'opaque' });
	});

	it('REQ-JWT-001 base64url-dotted strings that cannot be decoded are malformed with a reason', () => {
		const badHeader = inspectToken('abc.def.ghi');
		expect(badHeader.kind).toBe('malformed');
		const badPayload = inspectToken(`${enc({ alg: 'HS256' })}.@@@.sig`);
		expect(badPayload.kind).toBe('malformed');
		const wrongCount = inspectToken('aaa.bbb');
		expect(wrongCount).toMatchObject({ kind: 'malformed' });
		const badJwe = inspectToken('aaa.bbb.ccc.ddd.eee');
		expect(badJwe.kind).toBe('malformed');
		if (badHeader.kind === 'malformed') expect(badHeader.reason).toMatch(/header/i);
		if (badPayload.kind === 'malformed') expect(badPayload.reason).toMatch(/payload/i);
	});

	it('REQ-JWT-001 a payload that is not a JSON object is malformed', () => {
		const token = `${enc({ alg: 'HS256' })}.${enc([1, 2])}.sig`;
		expect(inspectToken(token).kind).toBe('malformed');
	});
});

describe('splitTokenSegments', () => {
	it('REQ-JWT-002 splits a jws into header, payload and signature segments joined by separators', async () => {
		const token = await signedToken();
		const segments = splitTokenSegments(token);
		expect(segments.map((s) => s.part)).toEqual([
			'header',
			'separator',
			'payload',
			'separator',
			'signature'
		]);
		expect(segments.map((s) => s.text).join('')).toBe(token);
		expect(segments[0].text).toBe(token.split('.')[0]);
	});

	it('REQ-JWT-002 non-jws tokens are returned as a single raw segment', () => {
		expect(splitTokenSegments('opaque-token')).toEqual([{ part: 'raw', text: 'opaque-token' }]);
	});

	it('REQ-JWT-002 decoded values are pretty-printed JSON with two-space indent', () => {
		expect(prettyJson({ a: 1, b: ['x'] })).toBe('{\n  "a": 1,\n  "b": [\n    "x"\n  ]\n}');
	});
});
