import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addAuthorizeParam, addFlow, addIdp, resultTab, run } from '../support/steps.ts';
import { expect, test } from './fixtures.ts';

/** The parsed HAR the app saved into the Node IPC temp dir, or null before it exists. */
async function savedHar(dir: string): Promise<unknown> {
	const name = (await readdir(dir)).find((n) => n.endsWith('.har'));
	return name ? JSON.parse(await readFile(join(dir, name), 'utf8')) : null;
}

test.describe('web journeys (mocked IPC, real mock IdP)', () => {
	test('REQ-E2E-001 PKCE happy path with spoofed redirect shows a decoded id_token with a valid signature', async ({
		app
	}) => {
		await addIdp(app, { clientId: 'public-spa' });
		await addFlow(app, 'New IdP', 'authorization_code_pkce');
		await app.getByLabel('Redirect URI').fill('http://spoofed.invalid/cb');
		await run(app);

		await expect(resultTab(app, 'Tokens')).toHaveAttribute('aria-selected', 'true');
		const idToken = app.getByRole('region', { name: /id.?token/i }).first();
		await expect(idToken.getByTestId('sig-badge')).toContainText('Signature valid');
		await expect(idToken.getByText('alice').first()).toBeVisible();
	});

	test('REQ-E2E-002 mock_error=access_denied shows the Errors tab with the error code', async ({
		app
	}) => {
		await addIdp(app, { clientId: 'public-spa' });
		await addFlow(app, 'New IdP', 'authorization_code_pkce');
		await app.getByLabel('Redirect URI').fill('http://spoofed.invalid/cb');
		await addAuthorizeParam(app, 'mock_error', 'access_denied');
		await run(app);

		await expect(resultTab(app, 'Errors')).toHaveAttribute('aria-selected', 'true');
		await expect(app.getByText('access_denied').first()).toBeVisible();
	});

	test('REQ-E2E-004 client_credentials with conf-basic shows an access token', async ({ app }) => {
		await addIdp(app, {
			clientId: 'conf-basic',
			auth: 'client_secret_basic',
			secret: 'basic-secret'
		});
		await addFlow(app, 'New IdP', 'client_credentials');
		await run(app);

		await expect(resultTab(app, 'Tokens')).toHaveAttribute('aria-selected', 'true');
		await expect(app.getByRole('region', { name: /access.?token/i }).first()).toBeVisible();
	});

	test('REQ-E2E-005 device flow: the user code is approved and polling returns tokens', async ({
		app
	}) => {
		await addIdp(app, { clientId: 'public-spa' });
		await addFlow(app, 'New IdP', 'device_code');
		await addAuthorizeParam(app, 'mock_auto_approve', '1');
		await run(app);

		await expect(resultTab(app, 'Tokens')).toHaveAttribute('aria-selected', 'true', {
			timeout: 30_000
		});
		await expect(app.getByRole('region', { name: /access.?token/i }).first()).toBeVisible();
	});

	test('REQ-E2E-007 HAR export writes valid JSON whose log.entries contain the run exchanges', async ({
		app,
		ipc
	}) => {
		await addIdp(app, {
			clientId: 'conf-basic',
			auth: 'client_secret_basic',
			secret: 'basic-secret'
		});
		await addFlow(app, 'New IdP', 'client_credentials');
		await run(app);
		await expect(resultTab(app, 'Tokens')).toHaveAttribute('aria-selected', 'true');

		await resultTab(app, 'Timeline').click();
		await app.getByRole('button', { name: 'Save HAR' }).click();

		await expect.poll(() => savedHar(ipc.state.tempDir)).not.toBeNull();
		const har = (await savedHar(ipc.state.tempDir)) as {
			log: { entries: { request: { url: string } }[] };
		};
		expect(har.log.entries.some((entry) => entry.request.url.endsWith('/token'))).toBe(true);
	});
});
