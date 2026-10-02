import { expect, type Page } from '@playwright/test';

export const MOCK_ISSUER = 'http://localhost:4455';

export interface IdpSetup {
	issuer?: string;
	clientId: string;
	auth?: 'none' | 'client_secret_basic' | 'client_secret_post' | 'client_secret_jwt';
	secret?: string;
	tlsInsecure?: boolean;
}

export async function waitForApp(page: Page): Promise<void> {
	await expect(page.getByRole('button', { name: 'Add IdP' })).toBeEnabled();
}

/** Adds an IdP, discovers its endpoints from the mock IdP, and fills the client. */
export async function addIdp(page: Page, setup: IdpSetup): Promise<void> {
	await page.getByRole('button', { name: 'Add IdP' }).click();
	await page.getByLabel('Issuer', { exact: true }).fill(setup.issuer ?? MOCK_ISSUER);
	if (setup.tlsInsecure) await page.getByRole('switch', { name: /Skip TLS validation/ }).click();
	await page.getByRole('button', { name: 'Discover' }).click();
	await expect(page.getByLabel('Token endpoint', { exact: true })).not.toHaveValue('');
	await page.getByLabel('Client ID').fill(setup.clientId);
	if (setup.auth) await page.getByLabel('Client authentication').selectOption(setup.auth);
	if (setup.secret) {
		await page.getByLabel('Client secret', { exact: true }).fill(setup.secret);
		await page.getByLabel('Client ID').click();
	}
}

/** Adds a flow of `type` to the IdP named `idpName` and selects it. */
export async function addFlow(page: Page, idpName: string, type: string): Promise<void> {
	await page.getByRole('button', { name: `Add flow to ${idpName}` }).click();
	await page.getByLabel('Flow type').selectOption(type);
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
}

export async function addAuthorizeParam(
	page: Page,
	name: string,
	value: string,
	addLabel = 'Add authorize param'
): Promise<void> {
	await page.getByRole('button', { name: addLabel }).click();
	await page.getByLabel('Name 1').fill(name);
	await page.getByLabel('Value 1').fill(value);
}

export async function run(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Run', exact: true }).click();
}

export function resultTab(page: Page, name: 'Tokens' | 'Errors' | 'Timeline') {
	return page.getByRole('region', { name: 'Results' }).getByRole('tab', { name });
}
