import { describe, expect, it } from 'vitest';
import {
	CLAIM_NAMES,
	claimLabel,
	describeClaim,
	formatClaimDate,
	rawClaimValue,
	viewClaim
} from './claims';

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const nowSeconds = NOW / 1000;

describe('describeClaim', () => {
	it('REQ-JWT-003 every standard claim has a non-empty description', () => {
		const expected = [
			'iss',
			'sub',
			'aud',
			'exp',
			'nbf',
			'iat',
			'auth_time',
			'nonce',
			'acr',
			'amr',
			'azp',
			'at_hash',
			'c_hash',
			'sid',
			'jti',
			'scope',
			'scp',
			'client_id',
			'email',
			'email_verified',
			'name',
			'preferred_username',
			'roles',
			'groups'
		];
		expect([...CLAIM_NAMES].sort()).toEqual([...expected].sort());
		for (const name of expected) {
			expect(describeClaim(name)?.length).toBeGreaterThan(3);
			expect(claimLabel(name)?.length).toBeGreaterThan(1);
		}
	});

	it('REQ-JWT-003 unknown claims show no description', () => {
		expect(describeClaim('x-custom')).toBeUndefined();
		expect(describeClaim('toString')).toBeUndefined();
		expect(describeClaim('__proto__')).toBeUndefined();
		expect(claimLabel('x-custom')).toBeUndefined();
		expect(claimLabel('toString')).toBeUndefined();
		expect(claimLabel('__proto__')).toBeUndefined();
	});

	it('REQ-JWT-003 labels are short human names', () => {
		expect(claimLabel('scp')).toBe('Scopes');
		expect(claimLabel('scope')).toBe('Scopes');
		expect(claimLabel('exp')).toBe('Expires');
		expect(claimLabel('sub')).toBe('Subject');
	});
});

describe('formatClaimDate', () => {
	it('REQ-JWT-004 a future exp shows ISO local time and "in 59 min"', () => {
		const exp = nowSeconds + 59 * 60;
		const date = formatClaimDate(exp, 'exp', NOW);
		expect(date).not.toBeNull();
		expect(date?.relative).toBe('in 59 min');
		expect(date?.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
		expect(new Date(date?.iso ?? '').getTime()).toBe(exp * 1000);
	});

	it('REQ-JWT-004 a past exp is shown as "expired 3 min ago"', () => {
		expect(formatClaimDate(nowSeconds - 3 * 60, 'exp', NOW)?.relative).toBe('expired 3 min ago');
	});

	it('REQ-JWT-004 other date claims use plain relative text and larger units', () => {
		expect(formatClaimDate(nowSeconds - 3 * 60, 'iat', NOW)?.relative).toBe('3 min ago');
		expect(formatClaimDate(nowSeconds + 30, 'nbf', NOW)?.relative).toBe('in 30 sec');
		expect(formatClaimDate(nowSeconds - 5 * 3600, 'auth_time', NOW)?.relative).toBe('5 h ago');
		expect(formatClaimDate(nowSeconds + 3 * 86400, 'exp', NOW)?.relative).toBe('in 3 d');
	});

	it('REQ-JWT-004 non-date claims and non-numeric dates have no date', () => {
		expect(formatClaimDate('soon', 'exp', NOW)).toBeNull();
		expect(formatClaimDate(5, 'sub', NOW)).toBeNull();
	});
});

describe('viewClaim', () => {
	it('REQ-JWT-004 viewClaim gives dates a readable text and a status badge', () => {
		const future = viewClaim('exp', nowSeconds + 3540, NOW, 'en-GB');
		expect(future).toMatchObject({
			kind: 'date',
			badge: { variant: 'success', text: 'expires in 59 min' }
		});
		if (future.kind !== 'date') throw new Error('expected date');
		expect(future.readable).toContain('2026');
		expect(future.readable).toContain('Oct');
		expect(future.iso).toBe(formatClaimDate(nowSeconds + 3540, 'exp', NOW)?.iso);

		expect(viewClaim('exp', nowSeconds - 180, NOW, 'en-GB')).toMatchObject({
			kind: 'date',
			badge: { variant: 'danger', text: 'expired 3 min ago' }
		});
		expect(viewClaim('nbf', nowSeconds + 30, NOW, 'en-GB')).toMatchObject({
			kind: 'date',
			badge: { variant: 'warning', text: 'valid in 30 sec' }
		});
		expect(viewClaim('nbf', nowSeconds - 180, NOW, 'en-GB')).toMatchObject({
			kind: 'date',
			badge: { variant: 'neutral', text: '3 min ago' }
		});
		expect(viewClaim('iat', nowSeconds - 180, NOW, 'en-GB')).toMatchObject({
			kind: 'date',
			badge: { variant: 'neutral', text: '3 min ago' }
		});
		expect(viewClaim('exp', 'soon', NOW, 'en-GB')).toEqual({ kind: 'text', text: 'soon' });
	});

	it('REQ-JWT-010 scope string becomes a list in token order with known descriptions', () => {
		const view = viewClaim('scope', 'profile openid  custom:read');
		expect(view.kind).toBe('list');
		if (view.kind !== 'list') return;
		expect(view.items.map((i) => i.value)).toEqual(['profile', 'openid', 'custom:read']);
		expect(view.items[0].description).toBeDefined();
		expect(view.items[1].description).toBeDefined();
		expect(view.items[2].description).toBeUndefined();
	});

	it('REQ-JWT-010 scp accepts a string or an array', () => {
		for (const value of [['b', 'a'], 'b a']) {
			const view = viewClaim('scp', value);
			expect(view.kind).toBe('list');
			if (view.kind === 'list') expect(view.items.map((i) => i.value)).toEqual(['b', 'a']);
		}
	});

	it('REQ-JWT-010 amr items carry RFC 8176 descriptions', () => {
		const view = viewClaim('amr', ['pwd', 'mfa', 'x']);
		expect(view.kind).toBe('list');
		if (view.kind !== 'list') return;
		expect(view.items[0].description).toBeDefined();
		expect(view.items[1].description).toBeDefined();
		expect(view.items[2].description).toBeUndefined();
	});

	it('REQ-JWT-010 other primitive arrays are lists, objects are JSON, verified flags are badges', () => {
		const aud = viewClaim('aud', ['a', 'b']);
		expect(aud).toEqual({
			kind: 'list',
			items: [{ value: 'a' }, { value: 'b' }]
		});
		const mixed = viewClaim('x', [1, true]);
		expect(mixed.kind === 'list' && mixed.items.map((i) => i.value)).toEqual(['1', 'true']);
		expect(viewClaim('x', [])).toEqual({ kind: 'text', text: '[]' });
		const obj = { street: 'x' };
		expect(viewClaim('address', obj)).toEqual({
			kind: 'json',
			json: JSON.stringify(obj, null, 2)
		});
		expect(viewClaim('x', [{ a: 1 }]).kind).toBe('json');
		expect(viewClaim('email_verified', true)).toEqual({ kind: 'flag', verified: true });
		expect(viewClaim('phone_number_verified', false)).toEqual({ kind: 'flag', verified: false });
		expect(viewClaim('email_verified', 'yes')).toEqual({ kind: 'text', text: 'yes' });
		expect(viewClaim('sub', 'alice')).toEqual({ kind: 'text', text: 'alice' });
		expect(viewClaim('x', true)).toEqual({ kind: 'text', text: 'true' });
	});
});

describe('rawClaimValue', () => {
	it('REQ-JWT-011 rawClaimValue copies strings verbatim and everything else as JSON', () => {
		expect(rawClaimValue('a b')).toBe('a b');
		expect(rawClaimValue(1700003540)).toBe('1700003540');
		expect(rawClaimValue(['a', 'b'])).toBe('["a","b"]');
		expect(rawClaimValue({ x: 1 })).toBe('{"x":1}');
	});
});
