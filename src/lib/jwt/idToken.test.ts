import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateIdToken, type IdTokenContext } from './idToken';

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const nowSec = NOW / 1000;

const ctx: IdTokenContext = {
	issuer: 'https://idp.example',
	clientId: 'client-1',
	nonce: 'n-0S6',
	now: NOW,
	requireAtHash: false,
	requireCHash: false
};

const basePayload = {
	iss: 'https://idp.example',
	aud: 'client-1',
	exp: nowSec + 300,
	iat: nowSec - 5,
	nonce: 'n-0S6'
};

const header = { alg: 'RS256' };

function row(rows: { id: string; level: string; message: string }[], id: string) {
	const found = rows.find((r) => r.id === id);
	if (!found) throw new Error(`no validation row ${id}`);
	return found;
}

function leftHalf(value: string, algo: 'sha256' | 'sha384' | 'sha512'): string {
	const digest = createHash(algo).update(value, 'ascii').digest();
	return digest.subarray(0, digest.length / 2).toString('base64url');
}

describe('validateIdToken iss', () => {
	it('REQ-IDT-001 iss equal to the issuer is ok', async () => {
		const rows = await validateIdToken(basePayload, header, ctx);
		expect(row(rows, 'idt.iss').level).toBe('ok');
	});

	it('REQ-IDT-001 a different or missing iss is an error', async () => {
		const wrong = await validateIdToken(
			{ ...basePayload, iss: 'https://evil.example' },
			header,
			ctx
		);
		expect(row(wrong, 'idt.iss').level).toBe('error');
		expect(row(wrong, 'idt.iss').message).toContain('https://evil.example');
		const { iss: _omitted, ...withoutIss } = basePayload;
		const missing = await validateIdToken(withoutIss, header, ctx);
		expect(row(missing, 'idt.iss').level).toBe('error');
	});
});

describe('validateIdToken aud and azp', () => {
	it('REQ-IDT-002 aud as string or array containing clientId is ok', async () => {
		const asString = await validateIdToken(basePayload, header, ctx);
		expect(row(asString, 'idt.aud').level).toBe('ok');
		const asArray = await validateIdToken(
			{ ...basePayload, aud: ['other', 'client-1'], azp: 'client-1' },
			header,
			ctx
		);
		expect(row(asArray, 'idt.aud').level).toBe('ok');
	});

	it('REQ-IDT-002 aud without clientId or missing is an error', async () => {
		const wrong = await validateIdToken({ ...basePayload, aud: ['other'] }, header, ctx);
		expect(row(wrong, 'idt.aud').level).toBe('error');
		const { aud: _omitted, ...withoutAud } = basePayload;
		const missing = await validateIdToken(withoutAud, header, ctx);
		expect(row(missing, 'idt.aud').level).toBe('error');
	});

	it('REQ-IDT-003 multiple audiences require azp equal to clientId', async () => {
		const multi = { ...basePayload, aud: ['client-1', 'other'] };
		const missing = await validateIdToken(multi, header, ctx);
		expect(row(missing, 'idt.azp').level).toBe('error');
		const wrong = await validateIdToken({ ...multi, azp: 'other' }, header, ctx);
		expect(row(wrong, 'idt.azp').level).toBe('error');
		const good = await validateIdToken({ ...multi, azp: 'client-1' }, header, ctx);
		expect(row(good, 'idt.azp').level).toBe('ok');
	});

	it('REQ-IDT-003 a single audience does not require azp', async () => {
		const rows = await validateIdToken(basePayload, header, ctx);
		expect(row(rows, 'idt.azp').level).toBe('ok');
		const mismatched = await validateIdToken({ ...basePayload, azp: 'other' }, header, ctx);
		expect(row(mismatched, 'idt.azp').level).toBe('warn');
	});
});

describe('validateIdToken exp and iat', () => {
	it('REQ-IDT-004 exp in the future is ok and expired within 60 s skew is ok', async () => {
		const future = await validateIdToken(basePayload, header, ctx);
		expect(row(future, 'idt.exp').level).toBe('ok');
		const skewed = await validateIdToken({ ...basePayload, exp: nowSec - 59 }, header, ctx);
		expect(row(skewed, 'idt.exp').level).toBe('ok');
	});

	it('REQ-IDT-004 exp older than 60 s or missing is an error', async () => {
		const boundary = await validateIdToken({ ...basePayload, exp: nowSec - 60 }, header, ctx);
		expect(row(boundary, 'idt.exp').level).toBe('error');
		const expired = await validateIdToken({ ...basePayload, exp: nowSec - 3600 }, header, ctx);
		expect(row(expired, 'idt.exp').level).toBe('error');
		expect(row(expired, 'idt.exp').message).toMatch(/expired/i);
		const { exp: _omitted, ...withoutExp } = basePayload;
		const missing = await validateIdToken(withoutExp, header, ctx);
		expect(row(missing, 'idt.exp').level).toBe('error');
	});

	it('REQ-IDT-004 a missing iat is an error and a present iat is ok', async () => {
		const { iat: _omitted, ...withoutIat } = basePayload;
		const missing = await validateIdToken(withoutIat, header, ctx);
		expect(row(missing, 'idt.iat').level).toBe('error');
		const present = await validateIdToken(basePayload, header, ctx);
		expect(row(present, 'idt.iat').level).toBe('ok');
	});
});

describe('validateIdToken nonce', () => {
	it('REQ-IDT-005 matching nonce is ok, mismatching or missing is an error', async () => {
		const good = await validateIdToken(basePayload, header, ctx);
		expect(row(good, 'idt.nonce').level).toBe('ok');
		const wrong = await validateIdToken({ ...basePayload, nonce: 'other' }, header, ctx);
		expect(row(wrong, 'idt.nonce').level).toBe('error');
		const { nonce: _omitted, ...withoutNonce } = basePayload;
		const missing = await validateIdToken(withoutNonce, header, ctx);
		expect(row(missing, 'idt.nonce').level).toBe('error');
	});

	it('REQ-IDT-005 when no nonce was sent a token nonce is a warning, otherwise nothing to check', async () => {
		const noneSent = { ...ctx, nonce: null };
		const withNonce = await validateIdToken(basePayload, header, noneSent);
		expect(row(withNonce, 'idt.nonce').level).toBe('warn');
		const { nonce: _omitted, ...withoutNonce } = basePayload;
		const without = await validateIdToken(withoutNonce, header, noneSent);
		expect(row(without, 'idt.nonce').level).toBe('ok');
	});
});

describe('validateIdToken at_hash', () => {
	const accessToken = 'ya29.access-token-value';

	it.each([
		['RS256', 'sha256'],
		['ES384', 'sha384'],
		['PS512', 'sha512']
	] as const)(
		'REQ-IDT-006 at_hash for %s is the left half of %s of the access token',
		async (alg, algo) => {
			const payload = { ...basePayload, at_hash: leftHalf(accessToken, algo) };
			const rows = await validateIdToken(payload, { alg }, { ...ctx, accessToken });
			expect(row(rows, 'idt.at_hash').level).toBe('ok');
			const bad = await validateIdToken(
				{ ...payload, at_hash: leftHalf('different', algo) },
				{ alg },
				{ ...ctx, accessToken }
			);
			expect(row(bad, 'idt.at_hash').level).toBe('error');
		}
	);

	it('REQ-IDT-006 at_hash is an error when required and missing, absent otherwise', async () => {
		const required = await validateIdToken(basePayload, header, {
			...ctx,
			accessToken,
			requireAtHash: true
		});
		expect(row(required, 'idt.at_hash').level).toBe('error');
		const optional = await validateIdToken(basePayload, header, { ...ctx, accessToken });
		expect(optional.some((r) => r.id === 'idt.at_hash')).toBe(false);
		const noToken = await validateIdToken({ ...basePayload, at_hash: 'whatever' }, header, ctx);
		expect(noToken.some((r) => r.id === 'idt.at_hash')).toBe(false);
	});

	it('REQ-IDT-006 an alg without a SHA suffix cannot be checked and is flagged', async () => {
		const rows = await validateIdToken(
			{ ...basePayload, at_hash: 'x' },
			{ alg: 'none' },
			{ ...ctx, accessToken }
		);
		expect(row(rows, 'idt.at_hash').level).toBe('error');
	});

	it('REQ-IDT-006 EdDSA uses SHA-512', async () => {
		const payload = { ...basePayload, at_hash: leftHalf(accessToken, 'sha512') };
		const rows = await validateIdToken(payload, { alg: 'EdDSA' }, { ...ctx, accessToken });
		expect(row(rows, 'idt.at_hash').level).toBe('ok');
	});
});

describe('validateIdToken c_hash', () => {
	const code = 'SplxlOBeZQQYbYS6WxSbIA';

	it('REQ-IDT-007 c_hash equals the left half of the code hash', async () => {
		const payload = { ...basePayload, c_hash: leftHalf(code, 'sha256') };
		const good = await validateIdToken(payload, header, { ...ctx, code, requireCHash: true });
		expect(row(good, 'idt.c_hash').level).toBe('ok');
		const bad = await validateIdToken(
			{ ...payload, c_hash: leftHalf('other-code', 'sha256') },
			header,
			{ ...ctx, code, requireCHash: true }
		);
		expect(row(bad, 'idt.c_hash').level).toBe('error');
	});

	it('REQ-IDT-007 c_hash is an error when required and missing, absent when not required', async () => {
		const required = await validateIdToken(basePayload, header, {
			...ctx,
			code,
			requireCHash: true
		});
		expect(row(required, 'idt.c_hash').level).toBe('error');
		const optional = await validateIdToken(basePayload, header, ctx);
		expect(optional.some((r) => r.id === 'idt.c_hash')).toBe(false);
	});
});
