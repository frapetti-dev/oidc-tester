import { describe, expect, it } from 'vitest';
import { MIT_LICENSE_TEXT, diagnosticsText, filterLicenses, type LicenseEntry } from './about';

const entry = (name: string): LicenseEntry => ({
	name,
	version: '1.0.0',
	license: 'MIT',
	source: 'npm',
	homepage: null
});

describe('about', () => {
	it('REQ-UI-026 diagnostics text is the five labelled lines joined with newlines', () => {
		expect(
			diagnosticsText({
				version: '0.1.0',
				tauriVersion: '2.12.1',
				webviewVersion: '131.0.0.0',
				os: 'Windows 10.0.26300 (64-bit)',
				dataDir: 'C:\\data'
			})
		).toBe(
			[
				'OIDC Tester 0.1.0',
				'Tauri 2.12.1',
				'WebView2 131.0.0.0',
				'OS Windows 10.0.26300 (64-bit)',
				'Data folder C:\\data'
			].join('\n')
		);
	});

	it('REQ-UI-025 the license filter matches names case-insensitively, trims, and keeps everything for an empty query', () => {
		const list = [entry('@tauri-apps/api'), entry('tauri'), entry('zod')];
		expect(filterLicenses(list, ' TAURI ').map((e) => e.name)).toEqual([
			'@tauri-apps/api',
			'tauri'
		]);
		expect(filterLicenses(list, '')).toBe(list);
		expect(filterLicenses(list, '   ')).toBe(list);
		expect(filterLicenses(list, 'nope')).toEqual([]);
	});

	it('REQ-UI-025 the shown license is the repository MIT license', () => {
		expect(MIT_LICENSE_TEXT.startsWith('MIT License')).toBe(true);
		expect(MIT_LICENSE_TEXT).toContain('Copyright (c) 2026 Federico Rapetti');
	});
});
