import { describe, expect, it } from 'vitest';
import { parseCallback } from './callback';

const expected = { state: 'st1', issuer: 'https://idp.test' };

describe('parseCallback', () => {
	it('REQ-CB-001 parses query parameters into named fields and raw', () => {
		const { callback, error } = parseCallback(
			'http://spoofed.invalid/cb?code=abc&state=st1&scope=openid%20profile&iss=https%3A%2F%2Fidp.test&extra=1',
			expected
		);
		expect(error).toBeNull();
		expect(callback.code).toBe('abc');
		expect(callback.state).toBe('st1');
		expect(callback.scope).toBe('openid profile');
		expect(callback.iss).toBe('https://idp.test');
		expect(callback.raw).toEqual({
			code: 'abc',
			state: 'st1',
			scope: 'openid profile',
			iss: 'https://idp.test',
			extra: '1'
		});
	});

	it('REQ-CB-001 parses fragment tokens and lets the fragment win on duplicate keys', () => {
		const { callback, error } = parseCallback(
			'http://spoofed.invalid/cb?state=st1&code=from-query&token_type=query#access_token=at&id_token=idt&token_type=Bearer&expires_in=3600&code=from-fragment',
			expected
		);
		expect(error).toBeNull();
		expect(callback.access_token).toBe('at');
		expect(callback.id_token).toBe('idt');
		expect(callback.token_type).toBe('Bearer');
		expect(callback.expires_in).toBe('3600');
		expect(callback.code).toBe('from-fragment');
		expect(callback.raw.code).toBe('from-fragment');
		expect(callback.state).toBe('st1');
	});

	it('REQ-CB-001 omits absent fields and tolerates a URL without parameters', () => {
		const { callback } = parseCallback('myapp://cb', { state: null, issuer: '' });
		expect(callback).toEqual({ raw: {} });
	});

	it('REQ-CB-002 differing state yields validation state_mismatch', () => {
		const { callback, error } = parseCallback('http://x.invalid/cb?code=abc&state=other', expected);
		expect(error).toMatchObject({ source: 'validation', error: 'state_mismatch' });
		expect(callback.code).toBe('abc');
	});

	it('REQ-CB-002 missing state while one was expected yields state_mismatch', () => {
		const { error } = parseCallback('http://x.invalid/cb?code=abc', expected);
		expect(error).toMatchObject({ source: 'validation', error: 'state_mismatch' });
	});

	it('REQ-CB-002 no state check when none was sent', () => {
		const { error } = parseCallback('http://x.invalid/cb?code=abc', {
			state: null,
			issuer: expected.issuer
		});
		expect(error).toBeNull();
	});

	it('REQ-CB-003 error parameters become an authorization RunError', () => {
		const { callback, error } = parseCallback(
			'http://x.invalid/cb?error=access_denied&error_description=User%20said%20no&error_uri=https%3A%2F%2Fdocs.test%2Fe&state=st1',
			expected
		);
		expect(error).toEqual({
			source: 'authorization',
			error: 'access_denied',
			error_description: 'User said no',
			error_uri: 'https://docs.test/e'
		});
		expect(callback.error).toBe('access_denied');
	});

	it('REQ-CB-003 authorization error from a fragment response takes precedence over state mismatch', () => {
		const { error } = parseCallback(
			'http://x.invalid/cb#error=invalid_scope&state=wrong',
			expected
		);
		expect(error).toMatchObject({ source: 'authorization', error: 'invalid_scope' });
		expect(error).not.toHaveProperty('error_description');
	});

	it('REQ-CB-004 iss different from the issuer yields iss_mismatch', () => {
		const { error } = parseCallback(
			'http://x.invalid/cb?code=abc&state=st1&iss=https%3A%2F%2Fevil.test',
			expected
		);
		expect(error).toMatchObject({ source: 'validation', error: 'iss_mismatch' });
	});

	it('REQ-CB-004 equal iss (modulo trailing slash) or absent iss is accepted', () => {
		const slash = parseCallback(
			'http://x.invalid/cb?code=abc&state=st1&iss=https%3A%2F%2Fidp.test%2F',
			expected
		);
		expect(slash.error).toBeNull();
		const absent = parseCallback('http://x.invalid/cb?code=abc&state=st1', {
			state: 'st1',
			issuer: 'https://idp.test/'
		});
		expect(absent.error).toBeNull();
	});

	it('REQ-CB-002 state mismatch is reported before iss mismatch', () => {
		const { error } = parseCallback(
			'http://x.invalid/cb?state=other&iss=https%3A%2F%2Fevil.test',
			expected
		);
		expect(error?.error).toBe('state_mismatch');
	});
});
