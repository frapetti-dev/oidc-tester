import type { FlowType } from '$lib/model/schema';

export const FIELD_IDS = [
	'redirectUri',
	'responseType',
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
	'audience',
	'resource',
	'username',
	'password',
	'refreshToken',
	'usePkce',
	'pkceMethod',
	'extraAuthParams',
	'extraTokenParams',
	'cleanSession',
	'headers'
] as const;

export type FieldId = (typeof FIELD_IDS)[number];

const AUTH_CODE_FIELDS: readonly FieldId[] = [
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
	'cleanSession'
];

/** Flow editor field matrix; flow-level `headers` is appended for every type. */
const MATRIX: Record<FlowType, readonly FieldId[]> = {
	authorization_code: AUTH_CODE_FIELDS,
	authorization_code_pkce: [...AUTH_CODE_FIELDS, 'pkceMethod'],
	implicit: [
		'responseType',
		'redirectUri',
		'scope',
		'responseMode',
		'state',
		'nonce',
		'prompt',
		'loginHint',
		'maxAge',
		'extraAuthParams',
		'cleanSession'
	],
	hybrid: ['responseType', 'usePkce', ...AUTH_CODE_FIELDS],
	client_credentials: ['scope', 'audience', 'resource', 'extraTokenParams'],
	password: ['username', 'password', 'scope', 'extraTokenParams'],
	refresh_token: ['refreshToken', 'scope', 'extraTokenParams'],
	device_code: ['scope', 'extraAuthParams', 'extraTokenParams', 'cleanSession']
};

/** Which editor fields are shown for a flow type. */
export function visibleFields(type: FlowType): Record<FieldId, boolean> {
	const shown = MATRIX[type];
	return Object.fromEntries(
		FIELD_IDS.map((id) => [id, id === 'headers' || shown.includes(id)])
	) as Record<FieldId, boolean>;
}
