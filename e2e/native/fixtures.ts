import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
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

/**
 * Stops the WebView2 processes that use `profileDir` and waits until they are gone, so a relaunch
 * on the same profile cannot attach to a dying browser (and the folder can be deleted).
 * Matches on the profile path only; other apps' WebView2 processes are left alone.
 */
async function releaseProfile(profileDir: string): Promise<void> {
	const script = `$p = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${profileDir}*' }); $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $p.Count`;
	for (let attempt = 0; attempt < 20; attempt++) {
		const left = execFileSync('powershell', ['-NoProfile', '-Command', script], {
			encoding: 'utf8'
		});
		if (Number(left.trim()) === 0) return;
		await sleep(250);
	}
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
	// The page can still be about:blank when CDP attaches, so poll for the app URL.
	let page: Page | undefined;
	for (let attempt = 0; attempt < 120 && !page; attempt++) {
		page = context.pages().find((p) => p.url().includes('tauri.localhost'));
		if (!page) await sleep(250);
	}
	if (!page) throw new Error('The app window never loaded http://tauri.localhost');
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
			await releaseProfile(join(dataRoot, 'webview2'));
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
		// WebView2 child processes can hold the profile for a moment after the kill.
		await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
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
