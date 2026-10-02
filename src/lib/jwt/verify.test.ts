import { describe, expect, it } from 'vitest';
import { CompactSign, SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { verifySignature } from './verify';

async function keyed(alg: string, kid: string) {
	const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true });
	const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' };
	return { jwk, privateKey };
}

function tamper(token: string): string {
	const [h, , s] = token.split('.');
	const payload = Buffer.from(JSON.stringify({ sub: 'mallory' })).toString('base64url');
	return `${h}.${payload}.${s}`;
}

describe('verifySignature with JWKS', () => {
	it.each(['RS256', 'PS384', 'ES256', 'ES384', 'EdDSA'])(
		'REQ-JWT-005 %s signature is valid with the matching JWKS key and invalid when tampered',
		async (alg) => {
			const { jwk, privateKey } = await keyed(alg, 'k1');
			const token = await new SignJWT({ sub: 'alice' })
				.setProtectedHeader({ alg, kid: 'k1' })
				.sign(privateKey);
			const jwks = { keys: [jwk] };

			const good = await verifySignature(token, { jwks, secret: null });
			expect(good.status).toBe('valid');
			expect(good.alg).toBe(alg);
			expect(good.kid).toBe('k1');

			const bad = await verifySignature(tamper(token), { jwks, secret: null });
			expect(bad.status).toBe('invalid');
			expect(bad.message.length).toBeGreaterThan(0);
		}
	);

	it('REQ-JWT-005 returns no_key when no JWKS key matches the kid', async () => {
		const signer = await keyed('RS256', 'k1');
		const other = await keyed('RS256', 'other');
		const token = await new SignJWT({ sub: 'alice' })
			.setProtectedHeader({ alg: 'RS256', kid: 'k1' })
			.sign(signer.privateKey);
		const result = await verifySignature(token, { jwks: { keys: [other.jwk] }, secret: null });
		expect(result.status).toBe('no_key');
	});

	it('REQ-JWT-005 returns no_key when the key type does not fit the alg', async () => {
		const signer = await keyed('RS256', 'k1');
		const ec = await keyed('ES256', 'k1');
		const token = await new SignJWT({ sub: 'alice' })
			.setProtectedHeader({ alg: 'RS256', kid: 'k1' })
			.sign(signer.privateKey);
		const result = await verifySignature(token, { jwks: { keys: [ec.jwk] }, secret: null });
		expect(result.status).toBe('no_key');
	});

	it('REQ-JWT-005 without kid every candidate key is tried', async () => {
		const first = await keyed('RS256', 'a');
		const second = await keyed('RS256', 'b');
		const token = await new SignJWT({ sub: 'alice' })
			.setProtectedHeader({ alg: 'RS256' })
			.sign(second.privateKey);
		const jwks = { keys: [first.jwk, second.jwk] };
		expect((await verifySignature(token, { jwks, secret: null })).status).toBe('valid');
		expect((await verifySignature(tamper(token), { jwks, secret: null })).status).toBe('invalid');
	});

	it('REQ-JWT-005 jwks null yields jwks_unavailable for asymmetric algs', async () => {
		const { privateKey } = await keyed('RS256', 'k1');
		const token = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).sign(privateKey);
		const result = await verifySignature(token, { jwks: null, secret: null });
		expect(result.status).toBe('jwks_unavailable');
	});
});

describe('verifySignature with client secret', () => {
	it.each(['HS256', 'HS384', 'HS512'])(
		'REQ-JWT-006 %s is checked with the client secret',
		async (alg) => {
			const key = new TextEncoder().encode('s3cret-value');
			const token = await new SignJWT({ sub: 'alice' }).setProtectedHeader({ alg }).sign(key);

			expect((await verifySignature(token, { jwks: null, secret: 's3cret-value' })).status).toBe(
				'valid'
			);
			expect((await verifySignature(token, { jwks: null, secret: 'wrong' })).status).toBe(
				'invalid'
			);
			expect(
				(await verifySignature(tamper(token), { jwks: null, secret: 's3cret-value' })).status
			).toBe('invalid');
		}
	);

	it('REQ-JWT-006 without a secret an HS token has no_key', async () => {
		const key = new TextEncoder().encode('s3cret-value');
		const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).sign(key);
		expect((await verifySignature(token, { jwks: null, secret: null })).status).toBe('no_key');
		expect((await verifySignature(token, { jwks: null, secret: '' })).status).toBe('no_key');
	});
});

describe('verifySignature unsigned', () => {
	it('REQ-JWT-007 alg none is unsigned regardless of keys', async () => {
		const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
		const token = `${enc({ alg: 'none' })}.${enc({ sub: 'alice' })}.`;
		const result = await verifySignature(token, { jwks: { keys: [] }, secret: 'x' });
		expect(result.status).toBe('unsigned');
		expect(result.message).toMatch(/unsigned/i);
	});

	it('REQ-JWT-007 alg None in any case is unsigned', async () => {
		const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
		const token = `${enc({ alg: 'None' })}.${enc({ sub: 'alice' })}.abc`;
		expect((await verifySignature(token, { jwks: null, secret: null })).status).toBe('unsigned');
	});
});

describe('verifySignature on non-verifiable input', () => {
	it('REQ-JWT-005 tokens that are not a JWS are invalid with an explanation', async () => {
		const result = await verifySignature('opaque-token', { jwks: null, secret: null });
		expect(result.status).toBe('invalid');
		expect(result.message).toMatch(/not a (signed )?JWT|JWS/i);
	});

	it('REQ-JWT-005 a token with an unsupported alg is invalid', async () => {
		const jws = await new CompactSign(new TextEncoder().encode('{}'))
			.setProtectedHeader({ alg: 'HS256' })
			.sign(new TextEncoder().encode('k'));
		const [, p, s] = jws.split('.');
		const header = Buffer.from(JSON.stringify({ alg: 'XX999' })).toString('base64url');
		const result = await verifySignature(`${header}.${p}.${s}`, {
			jwks: { keys: [] },
			secret: 'k'
		});
		expect(result.status).toBe('invalid');
	});
});
