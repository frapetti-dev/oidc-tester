const DESCRIPTIONS: Record<string, string> = {
	iss: 'Issuer: identifies the party that issued the token',
	sub: 'Subject: unique identifier of the user (or client) the token is about',
	aud: 'Audience: the recipients the token is intended for',
	exp: 'Expiration time: the token must not be accepted after this instant',
	nbf: 'Not before: the token must not be accepted before this instant',
	iat: 'Issued at: when the token was issued',
	auth_time: 'Authentication time: when the user last actively authenticated',
	nonce: 'Nonce: value from the authorization request binding the token to the client session',
	acr: 'Authentication Context Class Reference: assurance level of the authentication',
	amr: 'Authentication Methods References: methods used to authenticate (e.g. pwd, mfa)',
	azp: 'Authorized party: the client the token was issued to',
	at_hash: 'Access token hash: left half of the hash of the access token, binds it to the ID token',
	c_hash: 'Code hash: left half of the hash of the authorization code, binds it to the ID token',
	sid: 'Session ID: identifies the IdP session of the user',
	jti: 'JWT ID: unique identifier of this token',
	scope: 'Scope: space-separated permissions granted to the token',
	scp: 'Scope (Azure AD / Okta style): permissions granted to the token',
	client_id: 'Client ID: the OAuth client the token was issued to',
	email: 'Email address of the user',
	email_verified: 'Whether the IdP has verified the email address',
	name: 'Full display name of the user',
	preferred_username: 'Shorthand name by which the user wishes to be referred to',
	roles: 'Roles assigned to the user',
	groups: 'Groups the user belongs to'
};

/** Names of every claim with a description (REQ-JWT-003). */
export const CLAIM_NAMES: readonly string[] = Object.keys(DESCRIPTIONS);

/** REQ-JWT-003: description for a claim, undefined for unknown claims. */
export function describeClaim(name: string): string | undefined {
	return Object.hasOwn(DESCRIPTIONS, name) ? DESCRIPTIONS[name] : undefined;
}

const DATE_CLAIMS = ['exp', 'nbf', 'iat', 'auth_time'];

export interface ClaimDate {
	/** ISO 8601 in the local time zone, with offset. */
	iso: string;
	/** Relative text such as `in 59 min` or `expired 3 min ago`. */
	relative: string;
}

function pad(value: number, width = 2): string {
	return String(value).padStart(width, '0');
}

function localIso(date: Date): string {
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? '+' : '-';
	const abs = Math.abs(offset);
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
		`${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
}

function span(seconds: number): string {
	if (seconds < 60) return `${seconds} sec`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
	if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`;
	return `${Math.floor(seconds / 86_400)} d`;
}

/** REQ-JWT-004: ISO local time and relative text for numeric date claims, null otherwise. */
export function formatClaimDate(
	value: unknown,
	name: string,
	now: number = Date.now()
): ClaimDate | null {
	if (!DATE_CLAIMS.includes(name) || typeof value !== 'number' || !Number.isFinite(value))
		return null;
	const target = value * 1000;
	const diffSeconds = Math.floor(Math.abs(target - now) / 1000);
	let relative: string;
	if (target >= now) relative = `in ${span(diffSeconds)}`;
	else relative = `${name === 'exp' ? 'expired ' : ''}${span(diffSeconds)} ago`;
	return { iso: localIso(new Date(target)), relative };
}

/** Display text for a claim value; date claims show ISO local time plus relative text. */
export function formatClaimValue(name: string, value: unknown, now: number = Date.now()): string {
	const date = formatClaimDate(value, name, now);
	if (date) return `${date.iso} (${date.relative})`;
	return typeof value === 'string' ? value : JSON.stringify(value);
}
