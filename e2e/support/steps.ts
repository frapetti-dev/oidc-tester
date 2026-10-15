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

/** Expands a collapsible form section unless it is already open (the state is remembered). */
export async function openSection(page: Page, title: string): Promise<void> {
	const header = page.getByRole('button', { name: title, exact: true });
	if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
}

/** Adds an IdP, discovers its endpoints from the mock IdP, then adds a client under it and fills it. */
export async function addIdp(page: Page, setup: IdpSetup): Promise<void> {
	await page.getByRole('button', { name: 'Add IdP' }).click();
	await page.getByLabel('Issuer', { exact: true }).fill(setup.issuer ?? MOCK_ISSUER);
	if (setup.tlsInsecure) {
		await openSection(page, 'Network');
		await page.getByRole('switch', { name: /Skip TLS validation/ }).click();
	}
	await page.getByRole('button', { name: 'Discover' }).click();
	await expect(page.getByLabel('Token endpoint', { exact: true })).not.toHaveValue('');
	await page.getByRole('button', { name: 'Add client to New IdP' }).click();
	await page.getByLabel('Client ID').fill(setup.clientId);
	if (setup.auth) await page.getByLabel('Client authentication').selectOption(setup.auth);
	if (setup.secret) {
		await page.getByLabel('Client secret', { exact: true }).fill(setup.secret);
		await page.getByLabel('Client ID').click();
	}
}

/** Menu labels of the flow types the journeys add (`FLOW_TYPE_LABELS` in the app). */
const FLOW_LABELS: Record<string, string> = {
	authorization_code_pkce: 'Authorization Code + PKCE',
	client_credentials: 'Client Credentials',
	device_code: 'Device Code'
};

/** Adds a flow of `type` to the client named `clientName` and selects it. */
export async function addFlow(page: Page, clientName: string, type: string): Promise<void> {
	await page.getByRole('button', { name: `Add flow to ${clientName}` }).click();
	await page.getByRole('menuitem', { name: FLOW_LABELS[type], exact: true }).click();
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
