import { test as base, type Page } from '@playwright/test';
import { createNodeIpc, type NodeIpc } from '../../tests/support/nodeIpc.ts';
import { dispatch } from '../support/dispatch.ts';
import { waitForApp } from '../support/steps.ts';

interface Fixtures {
	/** Node implementation of the host commands; popup logs in as alice. */
	ipc: NodeIpc;
	/** The app page, loaded with every Tauri command routed to `ipc`. */
	app: Page;
}

export const test = base.extend<Fixtures>({
	ipc: async ({}, use) => {
		const ipc = createNodeIpc({ login: { username: 'alice', password: 'alice-pw' } });
		await use(ipc);
		await ipc.dispose();
	},
	app: async ({ page, ipc }, use) => {
		await page.exposeFunction('__e2eInvoke', (cmd: string, args: unknown) =>
			dispatch(ipc, cmd, args)
		);
		await page.goto('/');
		await waitForApp(page);
		await use(page);
	}
});

export { expect } from '@playwright/test';
