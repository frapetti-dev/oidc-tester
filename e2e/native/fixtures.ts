import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { chromium, test as base, expect, type Browser, type Page } from '@playwright/test';
import { waitForApp } from '../support/steps.ts';

const EXE = resolve('src-tauri/target/debug/oidc-tester.exe');

export interface RunningApp {
	page: Page;
	/** Kills the process tree and detaches Playwright. */
	close(): Promise<void>;
}

/** A TCP port nothing listens on, so a stale app from an earlier run can never be attached. */
async function freePort(): Promise<number> {
	const { promise, resolve, reject } = Promise.withResolvers<number>();
	const server = createServer();
	server.once('error', reject);
	server.listen(0, '127.0.0.1', () => {
		const { port } = server.address() as AddressInfo;
		server.close(() => resolve(port));
	});
	return promise;
}

async function connect(port: number): Promise<Browser> {
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		} catch {
			await sleep(500);
		}
	}
	throw new Error('Could not attach to the app over CDP');
}

/** Starts the app with documents, browser profile and WebView2 data redirected into `dataRoot`. */
async function launch(dataRoot: string): Promise<RunningApp> {
	const port = await freePort();
	const child: ChildProcess = spawn(EXE, [], {
		stdio: 'ignore',
		env: {
			...process.env,
			OIDCT_DATA_DIR: dataRoot,
			WEBVIEW2_USER_DATA_FOLDER: join(dataRoot, 'webview2'),
			WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`
		}
	});
	const browser = await connect(port);
	const context = browser.contexts()[0];
	const page =
		context.pages().find((p) => p.url().includes('tauri.localhost')) ??
		(await context.waitForEvent('page'));
	await page.waitForLoadState('domcontentloaded');
	await waitForApp(page);
	return {
		page,
		async close() {
			await browser.close().catch(() => undefined);
			if (child.pid) {
				try {
					execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
				} catch {
					// already exited
				}
			}
		}
	};
}

interface Fixtures {
	/** Fresh data root (workspaces, WebView2 profile) deleted after the test. */
	dataRoot: string;
	launch: (dataRoot?: string) => Promise<RunningApp>;
}

export const test = base.extend<Fixtures>({
	dataRoot: async ({}, use) => {
		const dir = mkdtempSync(join(tmpdir(), 'oidct-native-'));
		await use(dir);
		rmSync(dir, { recursive: true, force: true });
	},
	launch: async ({ dataRoot }, use) => {
		const running: RunningApp[] = [];
		await use(async (root = dataRoot) => {
			const app = await launch(root);
			running.push(app);
			return app;
		});
		for (const app of running) await app.close();
	}
});

test.skip(process.platform !== 'win32', 'The native suite drives WebView2 on Windows');

export { expect };
