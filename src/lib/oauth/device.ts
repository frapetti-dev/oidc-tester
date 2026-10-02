import { z } from 'zod';
import type { Header, IpcApi } from '$lib/ipc/types';
import type { RunError, Tokens, Validation } from '$lib/model/run';
import type { Flow, Idp } from '$lib/model/schema';
import { applyClientAuth, type Param } from './clientAuth';
import { buildTokenRequest, withExtraParams } from './tokenRequest';
import { parseJsonResponse, parseTokenResponse } from './tokenResponse';
import { buildRequestSpec, sendWithRedirects, type HttpLog } from './transport';

const DEFAULT_INTERVAL_SECONDS = 5;
const SLOW_DOWN_INCREMENT_SECONDS = 5;

const DeviceAuthorizationBody = z.object({
	device_code: z.string().min(1),
	user_code: z.string().min(1),
	// Some IdPs (Google) use the non-standard `verification_url`.
	verification_uri: z.string().min(1).optional(),
	verification_url: z.string().min(1).optional(),
	verification_uri_complete: z.string().min(1).optional().catch(undefined),
	expires_in: z.coerce.number().positive(),
	interval: z.coerce.number().positive().optional().catch(undefined)
});

/** What the UI shows while the user approves the device on another screen. */
export interface DeviceUserCode {
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	/** Epoch milliseconds (same clock as `now`). */
	expiresAt: number;
	/** Initial polling interval in seconds. */
	interval: number;
}

export interface DeviceFlowInput {
	idp: Idp;
	flow: Flow;
	secret: string | null;
	log: HttpLog;
	sleep: (ms: number) => Promise<void>;
	/** Epoch milliseconds. */
	now: () => number;
	onUserCode: (info: DeviceUserCode) => void;
	isCancelled: () => boolean;
}

export interface DeviceFlowResult {
	tokens?: Tokens;
	error?: RunError;
	cancelled?: boolean;
	validations: Validation[];
}

type Authorization =
	{ ok: true; deviceCode: string; info: DeviceUserCode } | { ok: false; error: RunError };

async function requestDeviceAuthorization(
	ipc: IpcApi,
	input: DeviceFlowInput
): Promise<Authorization> {
	const { idp, flow, secret, log } = input;
	const protocolHeaders: Header[] = [
		['Content-Type', 'application/x-www-form-urlencoded'],
		['Accept', 'application/json']
	];
	const auth = await applyClientAuth(
		{ headers: protocolHeaders, params: [] },
		idp.client,
		secret,
		idp.endpoints.token,
		input.now
	);
	if (!auth.ok) return auth;
	const scope: Param[] = flow.params.scope.trim() === '' ? [] : [['scope', flow.params.scope]];
	const params = withExtraParams([...auth.params, ...scope], flow.params.extraAuthParams);
	const spec = buildRequestSpec(idp, flow, {
		method: 'POST',
		url: idp.endpoints.deviceAuthorization,
		protocolHeaders: auth.headers,
		body: new URLSearchParams(params).toString()
	});

	const sent = await sendWithRedirects(ipc, spec, log);
	const parsed = parseJsonResponse(sent);
	if (!parsed.ok) return parsed;
	const body = DeviceAuthorizationBody.safeParse(parsed.json);
	const verificationUri = body.data?.verification_uri ?? body.data?.verification_url;
	if (!body.success || verificationUri === undefined) {
		return {
			ok: false,
			error: {
				source: 'token',
				error: 'invalid_response',
				error_description:
					'The device authorization response needs device_code, user_code, verification_uri and a positive expires_in',
				httpStatus: sent.final?.response.status,
				detail: (sent.final?.response.body ?? '').slice(0, 2048)
			}
		};
	}
	const interval = body.data.interval ?? DEFAULT_INTERVAL_SECONDS;
	const info: DeviceUserCode = {
		userCode: body.data.user_code,
		verificationUri,
		expiresAt: input.now() + body.data.expires_in * 1000,
		interval
	};
	if (body.data.verification_uri_complete !== undefined) {
		info.verificationUriComplete = body.data.verification_uri_complete;
	}
	return { ok: true, deviceCode: body.data.device_code, info };
}

/**
 * RFC 8628 device flow: request a device code, surface the user code, open the verification
 * page in the popup (not awaited) and poll the token endpoint until approval, an error,
 * expiry or cancellation. The popup is closed whenever polling stops.
 */
export async function runDeviceFlow(
	ipc: IpcApi,
	input: DeviceFlowInput
): Promise<DeviceFlowResult> {
	const { idp, flow, secret, log, sleep, now } = input;
	const validations: Validation[] = [];

	const authorization = await requestDeviceAuthorization(ipc, input);
	if (!authorization.ok) return { error: authorization.error, validations };
	const { deviceCode, info } = authorization;

	input.onUserCode(info);
	void ipc
		.authWindowOpen({
			url: info.verificationUriComplete ?? info.verificationUri,
			redirectUri: null,
			cleanSession: flow.cleanSession,
			title: 'Device login'
		})
		.catch(() => undefined);

	try {
		let interval = info.interval;
		for (;;) {
			if (input.isCancelled()) return { cancelled: true, validations };
			await sleep(interval * 1000);
			if (input.isCancelled()) return { cancelled: true, validations };
			if (now() >= info.expiresAt) {
				return {
					error: {
						source: 'token',
						error: 'expired_token',
						error_description: 'The device code expired before the user approved the request'
					},
					validations
				};
			}
			const request = await buildTokenRequest({
				idp,
				flow,
				grant: { type: 'device_code', deviceCode },
				secret,
				now
			});
			if (!request.ok) return { error: request.error, validations };
			const result = parseTokenResponse(await sendWithRedirects(ipc, request.spec, log));
			if (result.tokens) return { tokens: result.tokens, validations };
			const error = result.error;
			if (error?.source === 'token' && error.error === 'authorization_pending') continue;
			if (error?.source === 'token' && error.error === 'slow_down') {
				interval += SLOW_DOWN_INCREMENT_SECONDS;
				continue;
			}
			return { error, validations };
		}
	} finally {
		await ipc.authWindowClose().catch(() => undefined);
	}
}
