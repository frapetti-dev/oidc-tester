import { addFlow, addIdp, openSection, resultTab, run } from '../support/steps.ts';
import { expect, test } from './fixtures.ts';

test.describe('native journeys (real Tauri app over CDP)', () => {
	test('REQ-E2E-001 native: PKCE happy path through the real popup with a spoofed redirect', async ({
		launch
	}) => {
		const { page } = await launch();
		await addIdp(page, { clientId: 'public-spa' });
		await addFlow(page, 'New client', 'authorization_code_pkce');
		await page.getByLabel('Redirect URI').fill('http://spoofed.invalid/cb');
		await page.getByRole('button', { name: 'Add authorize param' }).click();
		await page.getByLabel('Name 1').fill('mock_auto_approve');
		await page.getByLabel('Value 1').fill('1');
		await run(page);

		await expect(resultTab(page, 'Tokens')).toHaveAttribute('aria-selected', 'true', {
			timeout: 30_000
		});
		await page.getByRole('tab', { name: 'ID token' }).click();
		await expect(page.getByTestId('sig-badge').first()).toContainText('Signature valid');
	});

	test('REQ-E2E-003 native: self-signed https gives a tls error until Skip TLS validation is on', async ({
		launch
	}) => {
		const { page } = await launch();
		await addIdp(page, {
			clientId: 'conf-basic',
			auth: 'client_secret_basic',
			secret: 'basic-secret'
		});
		await page.getByRole('button', { name: 'New IdP', exact: true }).click();
		await page.getByLabel('Token endpoint', { exact: true }).fill('https://localhost:4456/token');
		await addFlow(page, 'New client', 'client_credentials');
		try {
			await run(page);
			await expect(resultTab(page, 'Errors')).toHaveAttribute('aria-selected', 'true');
			await expect(page.getByText('tls', { exact: true }).first()).toBeVisible();

			await page.getByRole('button', { name: 'New IdP', exact: true }).click();
			await openSection(page, 'Network');
			await page.getByRole('switch', { name: /Skip TLS validation/ }).click();
			await page.getByRole('treeitem').first().click();
			await run(page);
			await expect(resultTab(page, 'Tokens')).toHaveAttribute('aria-selected', 'true');
		} finally {
			// Removes the client secret from the OS keychain.
			await page.getByRole('button', { name: 'More actions for New IdP' }).click();
			await page.getByRole('menuitem', { name: 'Delete…' }).click();
			await page.getByRole('button', { name: 'Delete', exact: true }).click();
		}
	});

	test('REQ-E2E-006 native: save-as keeps the content across a relaunch and empties the scratchpad', async ({
		launch,
		dataRoot
	}) => {
		const first = await launch();
		await addIdp(first.page, { clientId: 'public-spa' });
		await first.page.getByRole('button', { name: 'Workspace actions' }).click();
		await first.page.getByRole('menuitem', { name: 'Save as workspace…' }).click();
		await first.page
			.getByRole('dialog', { name: 'Save as workspace' })
			.getByLabel('Name')
			.fill('Saved workspace');
		await first.page.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(first.page.getByLabel('Workspace', { exact: true })).toHaveValue(/.+/);
		await expect(first.page.getByRole('button', { name: 'New IdP', exact: true })).toBeVisible();
		await first.close();

		const second = await launch(dataRoot);
		await second.page
			.getByLabel('Workspace', { exact: true })
			.selectOption({ label: 'Saved workspace' });
		await expect(second.page.getByRole('button', { name: 'New IdP', exact: true })).toBeVisible();
		await second.page
			.getByLabel('Workspace', { exact: true })
			.selectOption({ label: 'Scratchpad' });
		await expect(second.page.getByText('No IdPs yet')).toBeVisible();
	});
});
