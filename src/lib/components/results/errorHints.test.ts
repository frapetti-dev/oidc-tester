import { describe, expect, it } from 'vitest';
import { ERROR_HINTS, hintForError } from './errorHints';

const KNOWN_CODES = [
	'invalid_client',
	'invalid_grant',
	'unauthorized_client',
	'unsupported_grant_type',
	'invalid_scope',
	'access_denied',
	'invalid_request',
	'redirect_uri_mismatch',
	'state_mismatch',
	'iss_mismatch',
	'missing_client_secret',
	'tls',
	'timeout',
	'dns',
	'connect',
	'proxy'
];

describe('hintForError', () => {
	it.each(KNOWN_CODES)('REQ-ERR-002 %s has a non-empty hint', (code) => {
		expect(hintForError(code)?.trim().length).toBeGreaterThan(0);
	});

	it('REQ-ERR-002 tls hint names the Skip TLS validation setting', () => {
		expect(hintForError('tls')).toBe(
			"Certificate validation failed — enable 'Skip TLS validation' on the IdP to ignore"
		);
	});

	it('REQ-ERR-002 unknown codes (including Object prototype names) have no hint', () => {
		expect(hintForError('totally_unknown')).toBeUndefined();
		expect(hintForError('constructor')).toBeUndefined();
		expect(Object.keys(ERROR_HINTS).sort()).toEqual([...KNOWN_CODES].sort());
	});
});
