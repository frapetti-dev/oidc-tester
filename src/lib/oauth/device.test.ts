import { describe, expect, it } from 'vitest';
import type {
	AuthWindowArgs,
	Header,
	HttpExchange,
	HttpRequestSpec,
	HttpResult,
	IpcApi
} from '#lib/ipc/types.js';
import { newClient, newFlow, newIdp, type Client, type Idp } from '#lib/model/schema.js';
import { runDeviceFlow, type DeviceUserCode } from './device';
import { newHttpLog } from './transport';

const DEVICE_ENDPOINT = 'https://idp.test/device_authorization';
const TOKEN_ENDPOINT = 'https://idp.test/token';
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

type Reply = { status: number; body: unknown; headers?: Header[] };

const json = (status: number, body: unknown): Reply => ({ status, body });
const deviceReply = (over: Record<string, unknown> = {}): Reply =>
	json(200, {
		device_code: 'DEV123',
		user_code: 'ABCD-EFGH',
		verification_uri: 'https://idp.test/device',
		expires_in: 600,
		...over
	});
const pending = json(400, { error: 'authorization_pending' });
const success = json(200, { access_token: 'at', token_type: 'Bearer', refresh_token: 'rt' });

function makeIdp(auth: Client['auth'] = 'none'): Idp {
	const idp = newIdp();
	idp.endpoints.deviceAuthorization = DEVICE_ENDPOINT;
	idp.endpoints.token = TOKEN_ENDPOINT;
	const client = newClient();
	Object.assign(client, { clientId: 'cid', auth, hasSecret: auth !== 'none' });
	idp.clients.push(client);
	return idp;
}

function clientInput(idp: Idp): { idp: Idp; client: Client } {
	return { idp, client: idp.clients[0] };
}

function exchange(spec: HttpRequestSpec, reply: Reply): HttpExchange {
	return {
		id: crypto.randomUUID(),
		startedAt: '2026-01-01T00:00:00Z',
		durationMs: 1,
		request: { method: spec.method, url: spec.url, headers: spec.headers, body: spec.body },
		response: {
			status: reply.status,
			statusText: '',
			httpVersion: 'HTTP/1.1',
			headers: reply.headers ?? [['Content-Type', 'application/json']],
			body: JSON.stringify(reply.body),
			bodyBase64: null
		}
	};
}

interface Harness {
	ipc: IpcApi;
	deviceCalls: HttpRequestSpec[];
	tokenCalls: HttpRequestSpec[];
	opened: AuthWindowArgs[];
	closeCount: () => number;
	sleeps: number[];
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	userCodes: DeviceUserCode[];
}

/** `tokenReplies` are consumed in order, one per poll. */
function harness(device: Reply, tokenReplies: Reply[]): Harness {
	let clock = 1_000_000;
	let closes = 0;
	const h: Harness = {
		deviceCalls: [],
		tokenCalls: [],
		opened: [],
		closeCount: () => closes,
		sleeps: [],
		userCodes: [],
		sleep: async (ms) => {
			h.sleeps.push(ms);
			clock += ms;
		},
		now: () => clock,
		ipc: {
			httpSend: async (spec: HttpRequestSpec): Promise<HttpResult> => {
				if (spec.url === DEVICE_ENDPOINT) {
					h.deviceCalls.push(spec);
					return { ok: true, exchange: exchange(spec, device) };
				}
				h.tokenCalls.push(spec);
				const reply = tokenReplies[h.tokenCalls.length - 1];
				if (!reply) throw new Error('unexpected extra token poll');
				return { ok: true, exchange: exchange(spec, reply) };
			},
			// Never resolves: the popup must not be awaited.
			authWindowOpen: (args: AuthWindowArgs) => {
				h.opened.push(args);
				return new Promise<never>(() => {});
			},
			authWindowClose: async () => {
				closes++;
			}
		} as unknown as IpcApi
	};
	return h;
}

function run(
	h: Harness,
	over: { idp?: Idp; secret?: string | null; isCancelled?: () => boolean } = {}
) {
	const flow = newFlow('device_code');
	flow.params.scope = 'openid offline_access';
	return {
		flow,
		promise: runDeviceFlow(h.ipc, {
			...clientInput(over.idp ?? makeIdp()),
			flow,
			secret: over.secret ?? null,
			log: newHttpLog(),
			sleep: h.sleep,
			now: h.now,
			onUserCode: (info) => h.userCodes.push(info),
			isCancelled: over.isCancelled ?? (() => false)
		})
	};
}

const params = (spec: HttpRequestSpec) => new URLSearchParams(spec.body ?? '');

describe('runDeviceFlow', () => {
	it('REQ-FLOW-008 POSTs the device endpoint, reports the user code, opens the popup unawaited and closes it on success', async () => {
		const h = harness(
			deviceReply({ verification_uri_complete: 'https://idp.test/device?c=ABCD-EFGH' }),
			[success]
		);
		const flow = newFlow('device_code');
		flow.cleanSession = true;
		flow.params.scope = 'openid';
		flow.params.extraAuthParams = [
			{ name: 'audience', value: 'api', enabled: true },
			{ name: 'skip', value: 'x', enabled: false }
		];
		const result = await runDeviceFlow(h.ipc, {
			...clientInput(makeIdp()),
			flow,
			secret: null,
			log: newHttpLog(),
			sleep: h.sleep,
			now: h.now,
			onUserCode: (info) => h.userCodes.push(info),
			isCancelled: () => false
		});

		expect(h.deviceCalls).toHaveLength(1);
		expect(h.deviceCalls[0].method).toBe('POST');
		expect([...params(h.deviceCalls[0])]).toEqual([
			['client_id', 'cid'],
			['scope', 'openid'],
			['audience', 'api']
		]);
		expect(h.userCodes).toEqual([
			{
				userCode: 'ABCD-EFGH',
				verificationUri: 'https://idp.test/device',
				verificationUriComplete: 'https://idp.test/device?c=ABCD-EFGH',
				expiresAt: 1_000_000 + 600_000,
				interval: 5
			}
		]);
		expect(h.opened).toEqual([
			{
				url: 'https://idp.test/device?c=ABCD-EFGH',
				redirectUri: null,
				cleanSession: true,
				title: 'Device login'
			}
		]);
		expect(result.tokens?.access_token).toBe('at');
		expect(result.error).toBeUndefined();
		expect(h.closeCount()).toBe(1);
	});

	it('REQ-FLOW-008 opens verification_uri when there is no complete URI and polls with the device_code grant every 5 s by default', async () => {
		const h = harness(deviceReply(), [pending, pending, success]);
		const { promise } = run(h);
		const result = await promise;
		expect(h.opened[0].url).toBe('https://idp.test/device');
		expect(h.sleeps).toEqual([5000, 5000, 5000]);
		expect(h.tokenCalls).toHaveLength(3);
		for (const call of h.tokenCalls) {
			expect(call.url).toBe(TOKEN_ENDPOINT);
			expect(params(call).get('grant_type')).toBe(GRANT);
			expect(params(call).get('device_code')).toBe('DEV123');
		}
		expect(result.tokens?.access_token).toBe('at');
	});

	it('REQ-FLOW-008 honours the server interval and slow_down adds 5 s from then on', async () => {
		const h = harness(deviceReply({ interval: 2 }), [
			pending,
			json(400, { error: 'slow_down' }),
			pending,
			success
		]);
		await run(h).promise;
		expect(h.sleeps).toEqual([2000, 2000, 7000, 7000]);
		expect(h.userCodes[0].interval).toBe(2);
	});

	it.each([
		['access_denied', 'The user denied the request'],
		['expired_token', 'Device code expired'],
		['invalid_grant', 'Bad grant']
	])(
		'REQ-FLOW-008 %s stops polling with a token RunError and closes the popup',
		async (error, description) => {
			const h = harness(deviceReply(), [
				pending,
				json(400, { error, error_description: description })
			]);
			const result = await run(h).promise;
			expect(result.tokens).toBeUndefined();
			expect(result.error).toMatchObject({
				source: 'token',
				error,
				error_description: description,
				httpStatus: 400
			});
			expect(h.tokenCalls).toHaveLength(2);
			expect(h.closeCount()).toBe(1);
		}
	);

	it('REQ-FLOW-008 stops with expired_token once expires_in is reached and closes the popup', async () => {
		const h = harness(deviceReply({ expires_in: 12 }), [pending, pending]);
		const result = await run(h).promise;
		expect(h.tokenCalls).toHaveLength(2);
		expect(h.sleeps).toEqual([5000, 5000, 5000]);
		expect(result.error).toMatchObject({ source: 'token', error: 'expired_token' });
		expect(h.closeCount()).toBe(1);
	});

	it('REQ-FLOW-008 cancellation stops polling, reports cancelled and closes the popup', async () => {
		const h = harness(deviceReply(), [pending]);
		let polls = 0;
		const result = await run(h, {
			isCancelled: () => {
				polls++;
				return h.tokenCalls.length >= 1;
			}
		}).promise;
		expect(result.cancelled).toBe(true);
		expect(result.tokens).toBeUndefined();
		expect(result.error).toBeUndefined();
		expect(h.tokenCalls).toHaveLength(1);
		expect(polls).toBeGreaterThan(0);
		expect(h.closeCount()).toBe(1);
	});

	it('REQ-FLOW-008 a device authorization error stops the run without opening a popup', async () => {
		const h = harness(json(400, { error: 'invalid_client' }), []);
		const result = await run(h).promise;
		expect(result.error).toMatchObject({ source: 'token', error: 'invalid_client' });
		expect(h.opened).toHaveLength(0);
		expect(h.userCodes).toHaveLength(0);
		expect(h.sleeps).toHaveLength(0);
	});

	it('REQ-FLOW-008 a device authorization response without a user_code is an invalid_response', async () => {
		const h = harness(json(200, { device_code: 'x', expires_in: 60 }), []);
		const result = await run(h).promise;
		expect(result.error).toMatchObject({ source: 'token', error: 'invalid_response' });
		expect(h.opened).toHaveLength(0);
	});

	it('REQ-FLOW-008 applies client authentication to the device endpoint and fails fast without a secret', async () => {
		const basic = harness(deviceReply(), [success]);
		await run(basic, { idp: makeIdp('client_secret_basic'), secret: 'sec' }).promise;
		expect(basic.deviceCalls[0].headers).toContainEqual([
			'Authorization',
			`Basic ${btoa('cid:sec')}`
		]);
		expect(basic.tokenCalls[0].headers).toContainEqual([
			'Authorization',
			`Basic ${btoa('cid:sec')}`
		]);

		const missing = harness(deviceReply(), []);
		const result = await run(missing, { idp: makeIdp('client_secret_basic'), secret: null })
			.promise;
		expect(result.error).toMatchObject({ source: 'validation', error: 'missing_client_secret' });
		expect(missing.deviceCalls).toHaveLength(0);
	});
});
