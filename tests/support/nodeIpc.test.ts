import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startMockIdp } from '../mock-idp/server.ts';
import type { MockIdp } from '../mock-idp/server.ts';
import { createNodeIpc, matchesRedirect } from './nodeIpc.ts';
import type { NodeIpc, NodeIpcOptions } from './nodeIpc.ts';
import type { HttpRequestSpec, HttpResult } from '../../src/lib/ipc/types.ts';

const REDIRECT = 'http://spoofed.invalid/cb';

let idp: MockIdp;
let tlsIdp: MockIdp;
beforeAll(async () => {
	idp = await startMockIdp();
	tlsIdp = await startMockIdp({ tls: true });
}, 30_000);
afterAll(async () => {
	await Promise.all([idp.stop(), tlsIdp.stop()]);
});

const created: NodeIpc[] = [];
function make(options?: NodeIpcOptions): NodeIpc {
	const ipc = createNodeIpc(options);
	created.push(ipc);
	return ipc;
}
afterEach(async () => {
	await Promise.all(created.splice(0).map((i) => i.dispose()));
});

function spec(over: Partial<HttpRequestSpec> & { url: string }): HttpRequestSpec {
	return {
		method: 'GET',
		headers: [],
		body: null,
		tlsInsecure: false,
		proxy: { mode: 'none', url: null },
		timeoutMs: 5000,
		...over
	};
}

function ok(r: HttpResult) {
	if (!r.ok) throw new Error(`expected exchange, got ${r.failure.kind}: ${r.failure.message}`);
	return r.exchange;
}

function fail(r: HttpResult) {
	if (r.ok) throw new Error(`expected failure, got ${r.exchange.response.status}`);
	return r.failure;
}

async function listen(
	handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ server: Server; url: string }> {
	const server = createServer(handler);
	const ready = Promise.withResolvers<void>();
	server.listen(0, '127.0.0.1', () => ready.resolve());
	await ready.promise;
	return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function close(server: Server): Promise<void> {
	const done = Promise.withResolvers<void>();
	server.close(() => done.resolve());
	server.closeAllConnections();
	return done.promise;
}

describe('matchesRedirect', () => {
	it.each([
		['http://spoofed.invalid/cb?code=1#x', REDIRECT, true],
		['HTTP://SPOOFED.invalid/cb', REDIRECT, true],
		['http://spoofed.invalid:80/cb', REDIRECT, true],
		['https://spoofed.invalid:443/cb', 'https://spoofed.invalid/cb', true],
		['myapp://cb?code=1', 'myapp://cb', true],
		['http://spoofed.invalid:8080/cb', REDIRECT, false],
		['https://spoofed.invalid/cb', REDIRECT, false],
		['http://other.invalid/cb', REDIRECT, false],
		['http://spoofed.invalid/cb/', REDIRECT, false],
		['http://spoofed.invalid/other', REDIRECT, false],
		['not a url', REDIRECT, false]
	])('%s vs %s -> %s', (visited, redirect, expected) => {
		expect(matchesRedirect(visited, redirect)).toBe(expected);
	});
});

describe('httpSend', () => {
	it('records a full exchange: method, url, request headers/body verbatim, response status, headers and body', async () => {
		const ipc = make();
		const ex = ok(
			await ipc.httpSend(
				spec({
					method: 'POST',
					url: `${idp.url}/token`,
					headers: [
						['Content-Type', 'application/x-www-form-urlencoded'],
						['Accept', 'application/json'],
						['X-Custom', 'one']
					],
					body: 'grant_type=nope&client_id=public-spa'
				})
			)
		);
		expect(ex.request).toEqual({
			method: 'POST',
			url: `${idp.url}/token`,
			headers: [
				['Content-Type', 'application/x-www-form-urlencoded'],
				['Accept', 'application/json'],
				['X-Custom', 'one']
			],
			body: 'grant_type=nope&client_id=public-spa'
		});
		expect(ex.response).toMatchObject({
			status: 400,
			statusText: 'Bad Request',
			httpVersion: 'HTTP/1.1',
			bodyBase64: null
		});
		expect(JSON.parse(ex.response.body)).toMatchObject({ error: 'unsupported_grant_type' });
		expect(ex.response.headers).toContainEqual(['content-type', 'application/json; charset=utf-8']);
		expect(ex.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(new Date(ex.startedAt).toISOString()).toBe(ex.startedAt);
		expect(ex.durationMs).toBeGreaterThanOrEqual(0);
		expect(ipc.exchanges()).toEqual([ex]);
		expect(ipc.state.http).toHaveLength(1);

		const received = idp.requests.at(-1);
		expect(received?.headers['x-custom']).toBe('one');
		expect(received?.body).toBe('grant_type=nope&client_id=public-spa');
	});

	it('preserves header order and sends an Origin header untouched', async () => {
		const ipc = make();
		idp.clearRequests();
		ok(
			await ipc.httpSend(
				spec({
					url: `${idp.url}/jwks`,
					headers: [
						['X-C', '3'],
						['Origin', 'https://app.example'],
						['X-A', '1'],
						['X-B', '2']
					]
				})
			)
		);
		const names = Object.keys(idp.requests[0].headers).filter((h) =>
			['x-c', 'origin', 'x-a', 'x-b'].includes(h)
		);
		expect(names).toEqual(['x-c', 'origin', 'x-a', 'x-b']);
	});

	it('does not follow redirects and exposes Location', async () => {
		const ipc = make();
		const ex = ok(await ipc.httpSend(spec({ url: `${idp.url}/mock/redirect/1` })));
		expect(ex.response.status).toBe(302);
		expect(ex.response.headers).toContainEqual(['location', `${idp.url}/mock/redirect/0`]);
		expect(idp.requests.filter((r) => r.path.startsWith('/mock/redirect')).length).toBeGreaterThan(
			0
		);
	});

	it('keeps duplicate response headers as separate entries', async () => {
		const { server, url } = await listen((_req, res) => {
			res.setHeader('set-cookie', ['a=1', 'b=2']);
			res.end('x');
		});
		try {
			const ex = ok(await make().httpSend(spec({ url })));
			expect(ex.response.headers.filter(([n]) => n === 'set-cookie')).toEqual([
				['set-cookie', 'a=1'],
				['set-cookie', 'b=2']
			]);
		} finally {
			await close(server);
		}
	});

	it('returns non-UTF-8 payloads as base64 with an empty text body', async () => {
		const { server, url } = await listen((_req, res) => {
			res.end(Buffer.from([0xff, 0xfe, 0x00, 0x80]));
		});
		try {
			const ex = ok(await make().httpSend(spec({ url })));
			expect(ex.response.body).toBe('');
			expect(ex.response.bodyBase64).toBe(Buffer.from([0xff, 0xfe, 0x00, 0x80]).toString('base64'));
		} finally {
			await close(server);
		}
	});

	it('tls: fails with kind tls on a self-signed certificate unless tlsInsecure', async () => {
		const ipc = make();
		const f = fail(
			await ipc.httpSend(spec({ url: `${tlsIdp.url}/jwks`, headers: [['X-T', '1']] }))
		);
		expect(f.kind).toBe('tls');
		expect(f.message.toLowerCase()).toContain('self-signed');
		expect(f.request).toMatchObject({
			method: 'GET',
			url: `${tlsIdp.url}/jwks`,
			headers: [['X-T', '1']],
			body: null
		});
		const ex = ok(await ipc.httpSend(spec({ url: `${tlsIdp.url}/jwks`, tlsInsecure: true })));
		expect(ex.response.status).toBe(200);
		expect(ipc.failures()).toHaveLength(1);
		expect(ipc.exchanges()).toHaveLength(1);
	});

	it('timeout: maps a slow response to kind timeout', async () => {
		const f = fail(
			await make().httpSend(
				spec({ url: `${idp.url}/jwks`, headers: [['X-Mock-Delay-Ms', '800']], timeoutMs: 150 })
			)
		);
		expect(f.kind).toBe('timeout');
	});

	it('invalidRequest: unparsable URL and non-http schemes', async () => {
		const ipc = make();
		expect(fail(await ipc.httpSend(spec({ url: 'not a url' }))).kind).toBe('invalidRequest');
		expect(fail(await ipc.httpSend(spec({ url: 'ftp://example.test/x' }))).kind).toBe(
			'invalidRequest'
		);
		expect(
			fail(await ipc.httpSend(spec({ url: 'http://localhost/', method: 'BAD METHOD' }))).kind
		).toBe('invalidRequest');
	});

	it('connect: nothing listens on the port', async () => {
		const gone = await startMockIdp();
		const url = gone.url;
		await gone.stop();
		expect(fail(await make().httpSend(spec({ url: `${url}/jwks` }))).kind).toBe('connect');
	});

	it('dns: unresolvable host', async () => {
		expect(fail(await make().httpSend(spec({ url: 'http://no-such-host.invalid/' }))).kind).toBe(
			'dns'
		);
	});

	it('proxy url: requests go through the proxy; an unreachable proxy is kind proxy', async () => {
		const seen: string[] = [];
		const { server, url: proxyUrl } = await listen((req, res) => {
			seen.push(req.url ?? '');
			res.setHeader('x-via-proxy', '1');
			res.end('proxied');
		});
		try {
			const ipc = make();
			const ex = ok(
				await ipc.httpSend(
					spec({ url: 'http://target.invalid/hello', proxy: { mode: 'url', url: proxyUrl } })
				)
			);
			expect(ex.response.body).toBe('proxied');
			expect(seen).toEqual(['http://target.invalid/hello']);
			const direct = await ipc.httpSend(
				spec({ url: 'http://target.invalid/hello', proxy: { mode: 'none', url: null } })
			);
			expect(fail(direct).kind).toBe('dns');
		} finally {
			await close(server);
		}
		const dead = fail(
			await make().httpSend(
				spec({ url: 'http://target.invalid/x', proxy: { mode: 'url', url: 'http://127.0.0.1:1' } })
			)
		);
		expect(dead.kind).toBe('proxy');
	});
});

describe('authWindowOpen', () => {
	function authorizeUrl(params: Record<string, string>, base = idp.url): string {
		return `${base}/authorize?${new URLSearchParams({ client_id: 'public-spa', response_type: 'code', scope: 'openid', state: 's', redirect_uri: REDIRECT, ...params })}`;
	}

	it('captures the spoofed redirect without ever requesting it, with the navigation trail', async () => {
		const ipc = make();
		const url = authorizeUrl({ mock_auto_approve: '1' });
		idp.clearRequests();
		const r = await ipc.authWindowOpen({
			url,
			redirectUri: REDIRECT,
			cleanSession: false,
			title: 'Login'
		});
		expect(r.kind).toBe('captured');
		if (r.kind !== 'captured') return;
		expect(new URL(r.url).searchParams.get('code')).toBeTruthy();
		expect(new URL(r.url).searchParams.get('state')).toBe('s');
		expect(r.navigations.map((n) => n.url)).toEqual([url, r.url]);
		expect(r.navigations.every((n) => !Number.isNaN(Date.parse(n.at)))).toBe(true);
		expect(idp.requests.map((q) => q.path)).toEqual(['/authorize']);
		expect(ipc.state.authWindowOpens).toEqual([
			{ url, redirectUri: REDIRECT, cleanSession: false, title: 'Login' }
		]);
	});

	it('keeps fragments of implicit/hybrid redirects and works over https with a self-signed IdP', async () => {
		const ipc = make();
		const url = authorizeUrl(
			{ mock_auto_approve: '1', response_type: 'id_token token', nonce: 'n' },
			tlsIdp.url
		);
		const r = await ipc.authWindowOpen({
			url,
			redirectUri: REDIRECT,
			cleanSession: true,
			title: 't'
		});
		expect(r.kind).toBe('captured');
		if (r.kind !== 'captured') return;
		const fragment = new URLSearchParams(new URL(r.url).hash.slice(1));
		expect(fragment.get('access_token')).toBeTruthy();
		expect(fragment.get('id_token')).toBeTruthy();
	});

	it('captures custom schemes and default-port/case variations per the Rust matching rule', async () => {
		const ipc = make();
		const custom = await ipc.authWindowOpen({
			url: authorizeUrl({ mock_auto_approve: '1', redirect_uri: 'myapp://cb' }),
			redirectUri: 'myapp://cb',
			cleanSession: false,
			title: 't'
		});
		expect(custom.kind).toBe('captured');
		const variant = await ipc.authWindowOpen({
			url: authorizeUrl({ mock_auto_approve: '1', redirect_uri: 'http://SPOOFED.invalid:80/cb' }),
			redirectUri: REDIRECT,
			cleanSession: false,
			title: 't'
		});
		expect(variant.kind).toBe('captured');
	});

	it('reports captured errors from the IdP too (mock_error)', async () => {
		const r = await make().authWindowOpen({
			url: authorizeUrl({ mock_auto_approve: '1', mock_error: 'access_denied' }),
			redirectUri: REDIRECT,
			cleanSession: false,
			title: 't'
		});
		expect(r.kind === 'captured' && new URL(r.url).searchParams.get('error')).toBe('access_denied');
	});

	it('resolves closed when the page is not a redirect (login form, no credentials configured)', async () => {
		const r = await make().authWindowOpen({
			url: authorizeUrl({}),
			redirectUri: REDIRECT,
			cleanSession: false,
			title: 't'
		});
		expect(r.kind).toBe('closed');
		expect(r.navigations).toHaveLength(1);
	});

	it('resolves closed when the redirect does not match redirectUri, without fetching the redirect target', async () => {
		const r = await make().authWindowOpen({
			url: authorizeUrl({ mock_auto_approve: '1' }),
			redirectUri: 'http://spoofed.invalid/other',
			cleanSession: false,
			title: 't'
		});
		expect(r.kind).toBe('closed');
		expect(r.navigations.map((n) => new URL(n.url).pathname)).toEqual(['/authorize', '/cb']);
	});

	it('resolves closed when the authorize URL is unreachable', async () => {
		const r = await make().authWindowOpen({
			url: 'http://no-such-host.invalid/authorize',
			redirectUri: REDIRECT,
			cleanSession: false,
			title: 't'
		});
		expect(r.kind).toBe('closed');
	});

	it('submits the HTML login form with the configured credentials', async () => {
		const ipc = make({ login: { username: 'alice', password: 'alice-pw' } });
		idp.clearRequests();
		const r = await ipc.authWindowOpen({
			url: authorizeUrl({ state: 'form-state' }),
			redirectUri: REDIRECT,
			cleanSession: false,
			title: 't'
		});
		expect(r.kind).toBe('captured');
		if (r.kind !== 'captured') return;
		expect(new URL(r.url).searchParams.get('state')).toBe('form-state');
		expect(idp.requests.map((q) => `${q.method} ${q.path}`)).toEqual([
			'GET /authorize',
			'POST /authorize'
		]);
		expect(idp.requests[1].form).toMatchObject({
			username: 'alice',
			password: 'alice-pw',
			action: 'login',
			client_id: 'public-spa',
			redirect_uri: REDIRECT
		});
	});

	it('wrong credentials leave the form open (closed)', async () => {
		const ipc = make({ login: { username: 'alice', password: 'nope' } });
		const r = await ipc.authWindowOpen({
			url: authorizeUrl({}),
			redirectUri: REDIRECT,
			cleanSession: false,
			title: 't'
		});
		expect(r.kind).toBe('closed');
		expect(r.navigations).toHaveLength(2);
	});

	it('persistent sessions keep the SSO cookie; cleanSession starts fresh; browserClearSession wipes the profile', async () => {
		const ipc = make({ login: { username: 'alice', password: 'alice-pw' } });
		const url = authorizeUrl({});
		const win = (cleanSession: boolean) =>
			ipc.authWindowOpen({ url, redirectUri: REDIRECT, cleanSession, title: 't' });
		expect((await win(false)).kind).toBe('captured');
		expect(ipc.state.cookies.get('localhost')?.get('mock_sso')).toBeTruthy();

		ipc.options.login = null;
		expect((await win(false)).kind).toBe('captured'); // SSO, no form
		expect((await win(true)).kind).toBe('closed'); // clean session sees the form
		await ipc.browserClearSession();
		expect(ipc.state.browserSessionClears).toBe(1);
		expect((await win(false)).kind).toBe('closed');
	});

	it('redirectUri null (device flow): loads the page and stays open until authWindowClose', async () => {
		const ipc = make();
		let settled = false;
		const pending = ipc
			.authWindowOpen({
				url: `${idp.url}/device?user_code=ABCD-EFGH`,
				redirectUri: null,
				cleanSession: false,
				title: 'Device'
			})
			.then((r) => {
				settled = true;
				return r;
			});
		await expect
			.poll(() => idp.requests.some((q) => q.url === '/device?user_code=ABCD-EFGH'))
			.toBe(true);
		expect(settled).toBe(false);
		await ipc.authWindowClose();
		const r = await pending;
		expect(r.kind).toBe('closed');
		expect(r.navigations.map((n) => n.url)).toEqual([`${idp.url}/device?user_code=ABCD-EFGH`]);
		expect(ipc.state.authWindowCloses).toBe(1);
	});

	it('authWindowClose closes an in-flight window and is a no-op otherwise', async () => {
		const ipc = make();
		await ipc.authWindowClose();
		const pending = ipc.authWindowOpen({
			url: authorizeUrl({}),
			redirectUri: REDIRECT,
			cleanSession: false,
			title: 't'
		});
		await ipc.authWindowClose();
		expect((await pending).kind).toBe('closed');
		expect(ipc.state.authWindowCloses).toBe(2);
	});
});

describe('secrets', () => {
	it('stores, reads and deletes; unknown keys read as null; delete of unknown is fine', async () => {
		const ipc = make();
		expect(await ipc.secretGet('idp:1:client_secret')).toBeNull();
		await ipc.secretSet('idp:1:client_secret', 's3cret');
		expect(await ipc.secretGet('idp:1:client_secret')).toBe('s3cret');
		await ipc.secretSet('idp:1:client_secret', 'changed');
		expect(ipc.state.secrets.get('idp:1:client_secret')).toBe('changed');
		await ipc.secretDelete('idp:1:client_secret');
		await ipc.secretDelete('idp:1:client_secret');
		expect(await ipc.secretGet('idp:1:client_secret')).toBeNull();
	});
});

describe('docs', () => {
	it('round-trips JSON by value and returns null for missing docs', async () => {
		const ipc = make();
		const doc = { a: 1, nested: { list: ['x', 'y'] }, drop: undefined };
		expect(await ipc.docRead('workspaces/w1/workspace.json')).toBeNull();
		await ipc.docWrite('workspaces/w1/workspace.json', doc);
		doc.nested.list.push('mutated');
		const read = (await ipc.docRead('workspaces/w1/workspace.json')) as typeof doc;
		expect(read).toEqual({ a: 1, nested: { list: ['x', 'y'] } });
		read.nested.list.push('local');
		expect(await ipc.docRead('workspaces/w1/workspace.json')).toEqual({
			a: 1,
			nested: { list: ['x', 'y'] }
		});
	});

	it.each(['', '/abs', 'a//b', 'a/./b', 'a/../b', '../x', 'a\\b', 'c:/x', 'a/b:c', 'a/', './a'])(
		'rejects invalid path %j with "invalid path" on every operation',
		async (path) => {
			const ipc = make();
			await expect(ipc.docRead(path)).rejects.toThrow('invalid path');
			await expect(ipc.docWrite(path, {})).rejects.toThrow('invalid path');
			await expect(ipc.docList(path)).rejects.toThrow('invalid path');
			await expect(ipc.docDelete(path)).rejects.toThrow('invalid path');
		}
	);

	it('lists immediate json stems and sub-directories (sorted, de-duplicated), like the Rust storage', async () => {
		const ipc = make();
		await ipc.docWrite('workspaces/b/workspace.json', {});
		await ipc.docWrite('workspaces/a/workspace.json', {});
		await ipc.docWrite('workspaces/a/runs/r2.json', {});
		await ipc.docWrite('workspaces/a/runs/r1.json', {});
		await ipc.docWrite('workspaces/loose.json', {});
		await ipc.docWrite('workspaces2/x.json', {});
		expect(await ipc.docList('workspaces')).toEqual(['a', 'b', 'loose']);
		expect(await ipc.docList('workspaces/a/runs')).toEqual(['r1', 'r2']);
		expect(await ipc.docList('workspaces/a')).toEqual(['runs', 'workspace']);
		expect(await ipc.docList('missing')).toEqual([]);
	});

	it('deletes a file or a whole directory tree, but not siblings sharing a prefix; missing paths are fine', async () => {
		const ipc = make();
		await ipc.docWrite('workspaces/a/workspace.json', {});
		await ipc.docWrite('workspaces/a/runs/r1.json', {});
		await ipc.docWrite('workspaces/ab/workspace.json', {});
		await ipc.docDelete('workspaces/a/runs/r1.json');
		expect(await ipc.docList('workspaces/a')).toEqual(['workspace']);
		await ipc.docDelete('workspaces/a');
		await ipc.docDelete('workspaces/a');
		expect(await ipc.docList('workspaces')).toEqual(['ab']);
	});
});

describe('files, dialogs, openUrl', () => {
	it('writes and reads text files; relative paths live under the temp dir; dispose removes it', async () => {
		const ipc = make();
		await ipc.writeTextFile('exports/run.har', '{"log":{}}');
		expect(await ipc.readTextFile('exports/run.har')).toBe('{"log":{}}');
		expect(await ipc.readTextFile(`${ipc.state.tempDir}/exports/run.har`)).toBe('{"log":{}}');
		await expect(ipc.readTextFile('missing.txt')).rejects.toThrow();
		await ipc.dispose();
		expect(existsSync(ipc.state.tempDir)).toBe(false);
	});

	it('pickSavePath defaults to <tempDir>/<file name>, pickOpenPath to cancelled; both are configurable', async () => {
		const ipc = make();
		expect(await ipc.pickSavePath({ defaultPath: 'sub/dir/flow-1.har' })).toBe(
			join(ipc.state.tempDir, 'flow-1.har')
		);
		expect(await ipc.pickOpenPath({})).toBeNull();

		ipc.options.pickSavePath = null;
		ipc.options.pickOpenPath = 'C:/fixtures/ws.oidcws.json';
		expect(await ipc.pickSavePath({ defaultPath: 'x.har' })).toBeNull();
		expect(await ipc.pickOpenPath({ filters: [{ name: 'WS', extensions: ['json'] }] })).toBe(
			'C:/fixtures/ws.oidcws.json'
		);

		ipc.options.pickSavePath = (o) => `out-${o.defaultPath}`;
		expect(await ipc.pickSavePath({ defaultPath: 'a.har' })).toBe('out-a.har');
	});

	it('records opened URLs', async () => {
		const ipc = make();
		await ipc.openUrl('https://idp.example/device');
		await ipc.openUrl('https://idp.example/docs');
		expect(ipc.state.openedUrls).toEqual([
			'https://idp.example/device',
			'https://idp.example/docs'
		]);
	});
});
