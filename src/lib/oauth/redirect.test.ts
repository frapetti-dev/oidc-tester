import { describe, expect, it } from 'vitest';
import { redirectUriWarning } from './redirect';

describe('redirectUriWarning', () => {
	it('REQ-CAP-006 custom schemes get the exact warning', () => {
		const literal =
			'Custom-scheme redirect URIs may not be capturable on this platform; use http(s).';
		expect(redirectUriWarning('myapp://cb')).toBe(literal);
		expect(redirectUriWarning('com.example.app:/oauth2redirect')).toBe(literal);
	});

	it('REQ-CAP-006 http(s) and blank values get no warning', () => {
		expect(redirectUriWarning('http://localhost:8080/callback')).toBeNull();
		expect(redirectUriWarning('HTTPS://spoofed.invalid/cb')).toBeNull();
		expect(redirectUriWarning('')).toBeNull();
	});
});
