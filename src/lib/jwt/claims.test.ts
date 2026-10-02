import { describe, expect, it } from 'vitest';
import { CLAIM_NAMES, describeClaim, formatClaimDate, formatClaimValue } from './claims';

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
		for (const name of expected) expect(describeClaim(name)?.length).toBeGreaterThan(3);
	});

	it('REQ-JWT-003 unknown claims show no description', () => {
		expect(describeClaim('x-custom')).toBeUndefined();
		expect(describeClaim('toString')).toBeUndefined();
		expect(describeClaim('__proto__')).toBeUndefined();
	});
});

describe('formatClaimValue', () => {
	it('REQ-JWT-004 a future exp shows ISO local time and "in 59 min"', () => {
		const exp = nowSeconds + 59 * 60;
		const date = formatClaimDate(exp, 'exp', NOW);
		expect(date).not.toBeNull();
		expect(date?.relative).toBe('in 59 min');
		expect(date?.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
		expect(new Date(date?.iso ?? '').getTime()).toBe(exp * 1000);
		expect(formatClaimValue('exp', exp, NOW)).toBe(`${date?.iso} (in 59 min)`);
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

	it('REQ-JWT-004 non-date claims and non-numeric dates are rendered as plain values', () => {
		expect(formatClaimValue('sub', 'alice')).toBe('alice');
		expect(formatClaimValue('aud', ['a', 'b'])).toBe('["a","b"]');
		expect(formatClaimValue('email_verified', true)).toBe('true');
		expect(formatClaimValue('exp', 'soon')).toBe('soon');
		expect(formatClaimDate('soon', 'exp', NOW)).toBeNull();
		expect(formatClaimDate(5, 'sub', NOW)).toBeNull();
	});
});
