import { describe, expect, it } from 'vitest';
import { challenge, generateVerifier, randomToken } from './pkce';

describe('generateVerifier', () => {
	it('REQ-PKCE-001 verifier is exactly 64 unreserved characters and differs per call', () => {
		const a = generateVerifier();
		const b = generateVerifier();
		expect(a).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
		expect(b).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
		expect(a).not.toBe(b);
	});

	it('REQ-PKCE-001 uses the whole unreserved alphabet without bias toward early characters', () => {
		const seen = new Map<string, number>();
		const rounds = 4000;
		for (let i = 0; i < rounds; i++) {
			for (const ch of generateVerifier()) seen.set(ch, (seen.get(ch) ?? 0) + 1);
		}
		expect(seen.size).toBe(66);
		const expected = (rounds * 64) / 66;
		for (const count of seen.values()) {
			expect(count).toBeGreaterThan(expected * 0.85);
			expect(count).toBeLessThan(expected * 1.15);
		}
	});
});

describe('challenge', () => {
	it('REQ-PKCE-002 S256 challenge matches the RFC 7636 appendix B vector', async () => {
		expect(await challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'S256')).toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
		);
	});

	it('REQ-PKCE-002 S256 challenge is unpadded base64url of SHA-256 for any verifier', async () => {
		const verifier = generateVerifier();
		const digest = new Uint8Array(
			await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
		);
		const expected = Buffer.from(digest).toString('base64url');
		const result = await challenge(verifier, 'S256');
		expect(result).toBe(expected);
		expect(result).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('REQ-PKCE-003 plain challenge equals the verifier', async () => {
		expect(await challenge('abc-._~XYZ', 'plain')).toBe('abc-._~XYZ');
	});

	it('REQ-PKCE-004 regenerating yields a new verifier and a new code_challenge', async () => {
		const first = generateVerifier();
		const second = generateVerifier();
		expect(second).not.toBe(first);
		expect(await challenge(second, 'S256')).not.toBe(await challenge(first, 'S256'));
	});
});

describe('randomToken', () => {
	it('REQ-AUTHZ-002 randomToken is 32 random bytes encoded as unpadded base64url', () => {
		const a = randomToken();
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(Buffer.from(a, 'base64url')).toHaveLength(32);
		expect(randomToken()).not.toBe(a);
	});
});
