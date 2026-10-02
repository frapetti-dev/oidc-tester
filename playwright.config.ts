import { defineConfig } from '@playwright/test';

const WEB_PORT = 15174;

export default defineConfig({
	testDir: 'e2e',
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	workers: 1,
	reporter: [['list']],
	use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
	projects: [
		{ name: 'web', testDir: 'e2e/web', testMatch: '**/*.spec.ts' },
		{ name: 'native-build', testDir: 'e2e/native', testMatch: '**/build.setup.ts' },
		{
			name: 'native',
			testDir: 'e2e/native',
			testMatch: '**/*.spec.ts',
			dependencies: ['native-build']
		}
	],
	webServer: [
		{
			command: 'pnpm mock-idp',
			url: 'http://localhost:4455/.well-known/openid-configuration',
			reuseExistingServer: true
		},
		{
			command: `pnpm exec vite dev --port ${WEB_PORT}`,
			url: `http://localhost:${WEB_PORT}`,
			reuseExistingServer: true,
			env: { VITE_E2E: '1' }
		}
	]
});
