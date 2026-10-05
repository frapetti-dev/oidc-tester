import { describe, expect, it } from 'vitest';
import { FLOW_TYPES, type FlowType } from '#lib/model/schema.js';
import { FIELD_IDS, visibleFields, type FieldId } from './fieldMatrix';

const shown = (type: FlowType): FieldId[] => FIELD_IDS.filter((id) => visibleFields(type)[id]);

const AUTH_CODE: FieldId[] = [
	'redirectUri',
	'scope',
	'responseMode',
	'state',
	'nonce',
	'prompt',
	'loginHint',
	'maxAge',
	'acrValues',
	'uiLocales',
	'claims',
	'extraAuthParams',
	'extraTokenParams',
	'cleanSession',
	'headers'
];

const EXPECTED: Record<FlowType, FieldId[]> = {
	authorization_code: AUTH_CODE,
	authorization_code_pkce: [...AUTH_CODE, 'pkceMethod'],
	implicit: [
		'redirectUri',
		'responseType',
		'scope',
		'responseMode',
		'state',
		'nonce',
		'prompt',
		'loginHint',
		'maxAge',
		'extraAuthParams',
		'cleanSession',
		'headers'
	],
	hybrid: ['responseType', 'usePkce', ...AUTH_CODE],
	client_credentials: ['scope', 'audience', 'resource', 'extraTokenParams', 'headers'],
	password: ['username', 'password', 'scope', 'extraTokenParams', 'headers'],
	refresh_token: ['refreshToken', 'scope', 'extraTokenParams', 'headers'],
	device_code: ['scope', 'extraAuthParams', 'extraTokenParams', 'cleanSession', 'headers']
};

describe('visibleFields', () => {
	for (const type of FLOW_TYPES) {
		it(`REQ-FLOW-013 ${type} shows exactly its matrix fields`, () => {
			expect(new Set(shown(type))).toEqual(new Set(EXPECTED[type]));
		});
	}

	it('REQ-FLOW-013 headers always shown; pkceMethod only for authorization_code_pkce', () => {
		for (const type of FLOW_TYPES) {
			expect(visibleFields(type).headers).toBe(true);
			expect(visibleFields(type).pkceMethod).toBe(type === 'authorization_code_pkce');
		}
	});
});
