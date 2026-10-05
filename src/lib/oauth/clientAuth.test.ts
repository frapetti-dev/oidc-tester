import { decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import type { Header } from '#lib/ipc/types.js';
import { newIdp, type Idp } from '#lib/model/schema.js';
import { applyClientAuth } from './clientAuth';

type Client = Idp['client'];

const client = (over: Partial<Client>): Client => ({ ...newIdp().client, ...over });
const emptyReq = (): { headers: Header[]; params: [string, string][] } => ({
	headers: [['Accept', 'application/json']],
	params: [['grant_type', 'client_credentials']]
});
const TOKEN = 'https://idp.test/token';

function expectOk<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
	if (!r.ok) throw new Error('expected ok result');
	return r as Extract<T, { ok: true }>;
}

describe('applyClientAuth', () => {
	it('REQ-CAUTH-001 none sends only client_id in the body', async () => {
		const r = expectOk(
			await applyClientAuth(emptyReq(), client({ clientId: 'spa', auth: 'none' }), 'ignored', TOKEN)
		);
		expect(r.params).toEqual([
			['grant_type', 'client_credentials'],
			['client_id', 'spa']
		]);
		expect(r.headers).toEqual([['Accept', 'application/json']]);
	});

	it('REQ-CAUTH-002 basic form-urlencodes id and secret before base64', async () => {
		const r = expectOk(
			await applyClientAuth(
				emptyReq(),
				client({ clientId: 'a b', auth: 'client_secret_basic' }),
				'p:w/d',
				TOKEN
			)
		);
		expect(r.headers).toContainEqual(['Authorization', `Basic ${btoa('a+b:p%3Aw%2Fd')}`]);
		expect(r.params.map(([n]) => n)).toEqual(['grant_type']);
	});

	it('REQ-CAUTH-003 post sends client_id and client_secret in the body, no Authorization', async () => {
		const r = expectOk(
			await applyClientAuth(
				emptyReq(),
				client({ clientId: 'cid', auth: 'client_secret_post' }),
				's3cret',
				TOKEN
			)
		);
		expect(r.params).toEqual([
			['grant_type', 'client_credentials'],
			['client_id', 'cid'],
			['client_secret', 's3cret']
		]);
		expect(r.headers.some(([n]) => n.toLowerCase() === 'authorization')).toBe(false);
	});

	it.each(['HS256', 'HS384', 'HS512'] as const)(
		'REQ-CAUTH-004 client_secret_jwt signs the assertion with %s and the required claims',
		async (alg) => {
			const now = 1_700_000_000_000;
			const secret = 'jwt-secret-that-is-long-enough-for-hs512-signing-0123456789';
			const r = expectOk(
				await applyClientAuth(
					emptyReq(),
					client({ clientId: 'cid', auth: 'client_secret_jwt', jwtAlg: alg }),
					secret,
					TOKEN,
					() => now
				)
			);
			const params = new Map(r.params);
			expect(params.get('client_id')).toBe('cid');
			expect(params.get('client_assertion_type')).toBe(
				'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
			);
			expect(params.has('client_secret')).toBe(false);
			const assertion = params.get('client_assertion') ?? '';
			expect(decodeProtectedHeader(assertion).alg).toBe(alg);
			const { payload } = await jwtVerify(assertion, new TextEncoder().encode(secret), {
				currentDate: new Date(now)
			});
			expect(payload).toMatchObject({
				iss: 'cid',
				sub: 'cid',
				aud: TOKEN,
				iat: now / 1000,
				exp: now / 1000 + 60
			});
			expect(payload.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		}
	);

	it.each(['client_secret_basic', 'client_secret_post', 'client_secret_jwt'] as const)(
		'REQ-CAUTH-005 %s without a stored secret returns a validation error',
		async (auth) => {
			for (const secret of [null, '']) {
				const r = await applyClientAuth(
					emptyReq(),
					client({ clientId: 'cid', auth }),
					secret,
					TOKEN
				);
				expect(r).toMatchObject({
					ok: false,
					error: { source: 'validation', error: 'missing_client_secret' }
				});
			}
		}
	);
});
