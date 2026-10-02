export const CUSTOM_SCHEME_WARNING =
	'Custom-scheme redirect URIs may not be capturable on this platform; use http(s).';

/** The CAP-006 warning when the redirect URI has a scheme other than http/https; otherwise null. */
export function redirectUriWarning(uri: string): string | null {
	const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(uri)?.[1].toLowerCase();
	if (scheme === undefined || scheme === 'http' || scheme === 'https') return null;
	return CUSTOM_SCHEME_WARNING;
}
