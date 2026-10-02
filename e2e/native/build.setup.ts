import { execFileSync } from 'node:child_process';
import { test as setup } from '@playwright/test';

/** Builds the debug executable the native specs launch (frontend embedded, no installer). */
setup('build the Tauri debug executable', () => {
	setup.setTimeout(15 * 60_000);
	if (process.env.E2E_SKIP_BUILD === '1') return;
	const env = { ...process.env };
	const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'Path';
	env[pathKey] = `${env[pathKey] ?? ''};${process.env.USERPROFILE}\\.cargo\\bin`;
	execFileSync('pnpm', ['tauri', 'build', '--debug', '--no-bundle'], {
		stdio: 'inherit',
		shell: true,
		env
	});
});
