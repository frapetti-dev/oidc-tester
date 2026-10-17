import type { AppInfo } from '#lib/ipc/types.js';
import LICENSE_TEXT from '../../../LICENSE?raw';

export const REPO_URL = 'https://github.com/frapetti-dev/oidc-tester';
export const ISSUES_URL = `${REPO_URL}/issues`;

/** The repository `LICENSE` file, shown in About. */
export const MIT_LICENSE_TEXT = LICENSE_TEXT.trim();

export interface LicenseEntry {
	name: string;
	version: string;
	license: string;
	source: 'npm' | 'cargo';
	homepage: string | null;
}

/** REQ-UI-026: the five lines copied by `Copy diagnostics`. */
export function diagnosticsText(info: AppInfo): string {
	return [
		`OIDC Tester ${info.version}`,
		`Tauri ${info.tauriVersion}`,
		`WebView2 ${info.webviewVersion}`,
		`OS ${info.os}`,
		`Data folder ${info.dataDir}`
	].join('\n');
}

/** Case-insensitive name substring filter; an empty query keeps everything. */
export function filterLicenses(list: LicenseEntry[], query: string): LicenseEntry[] {
	const needle = query.trim().toLowerCase();
	if (needle === '') return list;
	return list.filter((entry) => entry.name.toLowerCase().includes(needle));
}
