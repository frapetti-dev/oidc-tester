import { describe, expect, it } from 'vitest';
import {
	newClient,
	newFlow,
	newIdp,
	type Client,
	type Flow,
	type FlowType,
	type Idp
} from '#lib/model/schema.js';
import { challenge } from './pkce';
import {
	buildAuthorizeUrl,
	generateAuthorizeValues,
	previewAuthorizeUrl,
	RESPONSE_MODE_OPTIONS,
	type AuthorizeValues
} from './authorize';

function setup(
	type: FlowType = 'authorization_code',
	patch: (flow: Flow, idp: Idp) => void = () => {}
) {
	const idp = newIdp();
	idp.endpoints.authorization = 'https://idp.test/authorize';
	const client = newClient();
	client.clientId = 'my-client';
	idp.clients.push(client);
	const flow = newFlow(type);
	flow.params.redirectUri = 'http://spoofed.invalid/cb';
	patch(flow, idp);
	return { idp, client, flow };
}

const values: AuthorizeValues = { state: 'st-1', nonce: 'no-1', codeVerifier: null };

async function build(
	idp: Idp,
	client: Client,
	flow: Flow,
	generated: AuthorizeValues = values
): Promise<URL> {
	const result = await buildAuthorizeUrl(idp, client, flow, generated);
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
	return new URL(result.url);
}

describe('buildAuthorizeUrl', () => {
	it('REQ-AUTHZ-001 contains response_type, client_id, redirect_uri, scope and state', async () => {
		const { idp, client, flow } = setup();
		const url = await build(idp, client, flow);
		expect(url.origin + url.pathname).toBe('https://idp.test/authorize');
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('client_id')).toBe('my-client');
		expect(url.searchParams.get('redirect_uri')).toBe('http://spoofed.invalid/cb');
		expect(url.searchParams.get('scope')).toBe('openid profile email');
		expect(url.searchParams.get('state')).toBe('st-1');
	});

	it.each([
		['authorization_code', 'code'],
		['authorization_code_pkce', 'code'],
		['implicit', 'id_token token'],
		['hybrid', 'code id_token']
	] as const)('REQ-AUTHZ-001 default response_type of %s is "%s"', async (type, expected) => {
		const { idp, client, flow } = setup(type);
		const verifier = 'v'.repeat(64);
		const url = await build(idp, client, flow, { ...values, codeVerifier: verifier });
		expect(url.searchParams.get('response_type')).toBe(expected);
	});

	it('REQ-AUTHZ-001 fails for flows without a front channel', async () => {
		const { idp, client, flow } = setup('client_credentials');
		const result = await buildAuthorizeUrl(idp, client, flow, values);
		expect(result).toMatchObject({ ok: false, error: { source: 'validation' } });
	});

	it('REQ-AUTHZ-001 fails when the authorization endpoint is empty or not a URL', async () => {
		const { idp, client, flow } = setup(
			'authorization_code',
			(_f, i) => (i.endpoints.authorization = '')
		);
		expect(await buildAuthorizeUrl(idp, client, flow, values)).toMatchObject({
			ok: false,
			error: { source: 'validation', error: 'missing_authorization_endpoint' }
		});
		idp.endpoints.authorization = 'not a url';
		expect(await buildAuthorizeUrl(idp, client, flow, values)).toMatchObject({
			ok: false,
			error: { source: 'validation', error: 'invalid_authorization_endpoint' }
		});
	});

	it('REQ-PKCE-002 PKCE flows send an S256 code_challenge derived from the verifier', async () => {
		const { idp, client, flow } = setup('authorization_code_pkce');
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
		const url = await build(idp, client, flow, { ...values, codeVerifier: verifier });
		expect(url.searchParams.get('code_challenge')).toBe(await challenge(verifier, 'S256'));
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
	});

	it('REQ-PKCE-003 plain method sends the verifier as code_challenge', async () => {
		const { idp, client, flow } = setup(
			'authorization_code_pkce',
			(f) => (f.params.pkceMethod = 'plain')
		);
		const url = await build(idp, client, flow, { ...values, codeVerifier: 'plain-verifier' });
		expect(url.searchParams.get('code_challenge')).toBe('plain-verifier');
		expect(url.searchParams.get('code_challenge_method')).toBe('plain');
	});

	it('REQ-PKCE-002 non-PKCE flows send no code_challenge; hybrid with usePkce does', async () => {
		const plain = setup('authorization_code');
		expect(
			(await build(plain.idp, plain.client, plain.flow)).searchParams.has('code_challenge')
		).toBe(false);

		const hybrid = setup('hybrid', (f) => (f.params.usePkce = true));
		const url = await build(hybrid.idp, hybrid.client, hybrid.flow, {
			...values,
			codeVerifier: 'x'.repeat(64)
		});
		expect(url.searchParams.has('code_challenge')).toBe(true);
	});

	it('REQ-PKCE-002 a PKCE flow without a generated verifier fails validation', async () => {
		const { idp, client, flow } = setup('authorization_code_pkce');
		expect(await buildAuthorizeUrl(idp, client, flow, values)).toMatchObject({
			ok: false,
			error: { source: 'validation', error: 'missing_code_verifier' }
		});
	});

	it('REQ-AUTHZ-002 state comes from the generated values verbatim', async () => {
		const { idp, client, flow } = setup();
		const url = await build(idp, client, flow, { ...values, state: 'a b&c' });
		expect(url.searchParams.get('state')).toBe('a b&c');
	});

	it('REQ-AUTHZ-003 nonce is included when present and omitted when mode is off', async () => {
		const { idp, client, flow } = setup();
		expect((await build(idp, client, flow)).searchParams.get('nonce')).toBe('no-1');
		flow.params.nonce.mode = 'off';
		expect(
			(await build(idp, client, flow, { ...values, nonce: null })).searchParams.has('nonce')
		).toBe(false);
	});

	it.each(['implicit', 'hybrid'] as const)(
		'REQ-AUTHZ-003 %s with id_token and nonce mode off fails with the required message',
		async (type) => {
			const { idp, client, flow } = setup(type, (f) => (f.params.nonce.mode = 'off'));
			const result = await buildAuthorizeUrl(idp, client, flow, { ...values, nonce: null });
			expect(result).toEqual({
				ok: false,
				error: {
					source: 'validation',
					error: 'nonce_required',
					error_description: 'nonce is required for response_type containing id_token'
				}
			});
		}
	);

	it('REQ-AUTHZ-003 response_type token (no id_token) does not require a nonce', async () => {
		const { idp, client, flow } = setup('implicit', (f) => {
			f.params.responseType = 'token';
			f.params.nonce.mode = 'off';
		});
		const url = await build(idp, client, flow, { ...values, nonce: null });
		expect(url.searchParams.has('nonce')).toBe(false);
	});

	it('REQ-AUTHZ-004 non-empty optional OIDC parameters are added, empty ones omitted', async () => {
		const { idp, client, flow } = setup('authorization_code', (f) => {
			f.params.prompt = 'login';
			f.params.loginHint = 'alice@example.com';
			f.params.maxAge = '300';
			f.params.acrValues = 'urn:mfa';
			f.params.uiLocales = 'it de';
			f.params.claims = '{"id_token":{"email":null}}';
		});
		const url = await build(idp, client, flow);
		expect(url.searchParams.get('prompt')).toBe('login');
		expect(url.searchParams.get('login_hint')).toBe('alice@example.com');
		expect(url.searchParams.get('max_age')).toBe('300');
		expect(url.searchParams.get('acr_values')).toBe('urn:mfa');
		expect(url.searchParams.get('ui_locales')).toBe('it de');
		expect(url.searchParams.get('claims')).toBe('{"id_token":{"email":null}}');

		const defaults = setup();
		const bare = await build(defaults.idp, defaults.client, defaults.flow);
		for (const name of [
			'prompt',
			'login_hint',
			'max_age',
			'acr_values',
			'ui_locales',
			'claims',
			'response_mode'
		]) {
			expect(bare.searchParams.has(name)).toBe(false);
		}
	});

	it('REQ-AUTHZ-004 response_mode is added only when set', async () => {
		const { idp, client, flow } = setup(
			'authorization_code',
			(f) => (f.params.responseMode = 'fragment')
		);
		expect((await build(idp, client, flow)).searchParams.get('response_mode')).toBe('fragment');
	});

	it('REQ-AUTHZ-005 enabled extra params are appended and same-name rows replace built-ins', async () => {
		const { idp, client, flow } = setup('authorization_code', (f) => {
			f.params.extraAuthParams = [
				{ name: 'audience', value: 'api://x', enabled: true },
				{ name: 'scope', value: 'custom', enabled: true },
				{ name: 'ignored', value: 'no', enabled: false },
				{ name: '  ', value: 'blank', enabled: true }
			];
		});
		const url = await build(idp, client, flow);
		expect(url.searchParams.get('audience')).toBe('api://x');
		expect(url.searchParams.getAll('scope')).toEqual(['custom']);
		expect(url.searchParams.has('ignored')).toBe(false);
		expect(url.searchParams.get('client_id')).toBe('my-client');
	});

	it('REQ-AUTHZ-005 an override keeps the built-in position', async () => {
		const { idp, client, flow } = setup('authorization_code', (f) => {
			f.params.extraAuthParams = [{ name: 'client_id', value: 'other', enabled: true }];
		});
		const url = await build(idp, client, flow);
		expect([...url.searchParams.keys()].slice(0, 2)).toEqual(['response_type', 'client_id']);
		expect(url.searchParams.get('client_id')).toBe('other');
	});

	it('REQ-AUTHZ-006 query parameters of the authorization endpoint are preserved', async () => {
		const { idp, client, flow } = setup('authorization_code', (_f, i) => {
			i.endpoints.authorization = 'https://idp.test/authorize?tenant=a&x=1';
		});
		const url = await build(idp, client, flow);
		expect(url.searchParams.get('tenant')).toBe('a');
		expect(url.searchParams.get('x')).toBe('1');
		expect(url.searchParams.get('response_type')).toBe('code');
	});
});

describe('generateAuthorizeValues', () => {
	it('REQ-AUTHZ-002 auto state is a fresh random token per call', () => {
		const { flow } = setup();
		const a = generateAuthorizeValues(flow);
		const b = generateAuthorizeValues(flow);
		expect(a.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(a.state).not.toBe(b.state);
	});

	it('REQ-AUTHZ-002 fixed state uses the configured value verbatim', () => {
		const { flow } = setup('authorization_code', (f) => {
			f.params.state = { mode: 'fixed', value: 'my fixed state' };
		});
		expect(generateAuthorizeValues(flow).state).toBe('my fixed state');
	});

	it('REQ-AUTHZ-003 nonce is random for auto, verbatim for fixed and null for off', () => {
		const { flow } = setup();
		expect(generateAuthorizeValues(flow).nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
		flow.params.nonce = { mode: 'fixed', value: 'nn' };
		expect(generateAuthorizeValues(flow).nonce).toBe('nn');
		flow.params.nonce = { mode: 'off', value: '' };
		expect(generateAuthorizeValues(flow).nonce).toBeNull();
	});

	it('REQ-PKCE-001 verifier is generated only for PKCE flows', () => {
		expect(generateAuthorizeValues(setup('authorization_code').flow).codeVerifier).toBeNull();
		expect(generateAuthorizeValues(setup('implicit').flow).codeVerifier).toBeNull();
		expect(generateAuthorizeValues(setup('authorization_code_pkce').flow).codeVerifier).toMatch(
			/^[A-Za-z0-9\-._~]{64}$/
		);
		expect(
			generateAuthorizeValues(setup('hybrid', (f) => (f.params.usePkce = true)).flow).codeVerifier
		).toHaveLength(64);
	});

	it('REQ-AUTHZ-008 existing values are reused for auto state/nonce/verifier but fixed values follow the flow', () => {
		const { flow } = setup('authorization_code_pkce');
		const first = generateAuthorizeValues(flow);
		expect(generateAuthorizeValues(flow, first)).toEqual(first);
		flow.params.state = { mode: 'fixed', value: 'now-fixed' };
		expect(generateAuthorizeValues(flow, first).state).toBe('now-fixed');
	});
});

describe('previewAuthorizeUrl', () => {
	it('REQ-AUTHZ-008 returns the URL and the values it used so the preview stays stable between edits', async () => {
		const { idp, client, flow } = setup('authorization_code_pkce');
		const first = await previewAuthorizeUrl(idp, client, flow);
		if (!first.ok) throw new Error('expected ok');
		const edited = { ...flow, params: { ...flow.params, scope: 'openid' } };
		const second = await previewAuthorizeUrl(idp, client, edited, first.values);
		if (!second.ok) throw new Error('expected ok');
		const a = new URL(first.url).searchParams;
		const b = new URL(second.url).searchParams;
		expect(b.get('scope')).toBe('openid');
		expect(b.get('state')).toBe(a.get('state'));
		expect(b.get('code_challenge')).toBe(a.get('code_challenge'));
	});

	it('REQ-AUTHZ-008 returns the validation message when the URL cannot be built', async () => {
		const { idp, client, flow } = setup('implicit', (f) => (f.params.nonce.mode = 'off'));
		const result = await previewAuthorizeUrl(idp, client, flow);
		expect(result).toMatchObject({
			ok: false,
			message: 'nonce is required for response_type containing id_token'
		});
	});
});

describe('RESPONSE_MODE_OPTIONS', () => {
	it('REQ-AUTHZ-007 offers default (omit), query and fragment but not form_post', () => {
		expect(RESPONSE_MODE_OPTIONS.map((o) => o.value)).toEqual(['', 'query', 'fragment']);
		expect(RESPONSE_MODE_OPTIONS[0].label).toBe('default (omit)');
		expect(RESPONSE_MODE_OPTIONS.some((o) => o.value === ('form_post' as string))).toBe(false);
	});
});
