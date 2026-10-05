import type { HttpExchange } from '#lib/ipc/types.js';
import { newFlow, newIdp } from '#lib/model/schema.js';
import type { Run } from '#lib/model/run.js';

export function sampleExchange(
	id: string,
	startedAt: string,
	overrides: Partial<HttpExchange> = {}
) {
	const exchange: HttpExchange = {
		id,
		startedAt,
		durationMs: 42,
		request: {
			method: 'POST',
			url: 'https://idp.test/token',
			headers: [['Content-Type', 'application/x-www-form-urlencoded']],
			body: 'grant_type=authorization_code&code=abc'
		},
		response: {
			status: 200,
			statusText: 'OK',
			httpVersion: 'HTTP/1.1',
			headers: [['Content-Type', 'application/json']],
			body: '{"access_token":"at","token_type":"Bearer"}',
			bodyBase64: null
		},
		...overrides
	};
	return exchange;
}

export function sampleRun(id = 'run-1', overrides: Partial<Run> = {}): Run {
	const flow = newFlow('authorization_code_pkce');
	flow.name = 'PKCE flow';
	const idp = newIdp();
	return {
		id,
		workspaceId: 'scratchpad',
		idpId: idp.id,
		flowId: flow.id,
		flowSnapshot: flow,
		idpSnapshot: idp,
		startedAt: '2026-01-01T10:00:00.000Z',
		finishedAt: '2026-01-01T10:00:05.000Z',
		status: 'success',
		navigations: [
			{ url: 'https://idp.test/authorize?client_id=x', at: '2026-01-01T10:00:01.000Z' },
			{ url: 'http://spoofed.invalid/cb?code=abc', at: '2026-01-01T10:00:03.000Z' }
		],
		exchanges: [
			sampleExchange('disc', '2026-01-01T10:00:00.000Z', {
				request: {
					method: 'GET',
					url: 'https://idp.test/.well-known/openid-configuration',
					headers: [],
					body: null
				}
			}),
			sampleExchange('token', '2026-01-01T10:00:04.000Z')
		],
		failures: [],
		validations: [],
		...overrides
	};
}
