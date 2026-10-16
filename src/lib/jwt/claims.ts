const CLAIMS: Record<string, { label: string; description: string }> = {
	iss: { label: 'Issuer', description: 'Issuer: identifies the party that issued the token' },
	sub: {
		label: 'Subject',
		description: 'Subject: unique identifier of the user (or client) the token is about'
	},
	aud: { label: 'Audience', description: 'Audience: the recipients the token is intended for' },
	exp: {
		label: 'Expires',
		description: 'Expiration time: the token must not be accepted after this instant'
	},
	nbf: {
		label: 'Not before',
		description: 'Not before: the token must not be accepted before this instant'
	},
	iat: { label: 'Issued at', description: 'Issued at: when the token was issued' },
	auth_time: {
		label: 'Authenticated at',
		description: 'Authentication time: when the user last actively authenticated'
	},
	nonce: {
		label: 'Nonce',
		description:
			'Nonce: value from the authorization request binding the token to the client session'
	},
	acr: {
		label: 'Auth context',
		description: 'Authentication Context Class Reference: assurance level of the authentication'
	},
	amr: {
		label: 'Auth methods',
		description: 'Authentication Methods References: methods used to authenticate (e.g. pwd, mfa)'
	},
	azp: {
		label: 'Authorized party',
		description: 'Authorized party: the client the token was issued to'
	},
	at_hash: {
		label: 'Access token hash',
		description:
			'Access token hash: left half of the hash of the access token, binds it to the ID token'
	},
	c_hash: {
		label: 'Code hash',
		description:
			'Code hash: left half of the hash of the authorization code, binds it to the ID token'
	},
	sid: { label: 'Session ID', description: 'Session ID: identifies the IdP session of the user' },
	jti: { label: 'Token ID', description: 'JWT ID: unique identifier of this token' },
	scope: {
		label: 'Scopes',
		description: 'Scope: space-separated permissions granted to the token'
	},
	scp: {
		label: 'Scopes',
		description: 'Scope (Azure AD / Okta style): permissions granted to the token'
	},
	client_id: {
		label: 'Client ID',
		description: 'Client ID: the OAuth client the token was issued to'
	},
	email: { label: 'Email', description: 'Email address of the user' },
	email_verified: {
		label: 'Email verified',
		description: 'Whether the IdP has verified the email address'
	},
	name: { label: 'Full name', description: 'Full display name of the user' },
	preferred_username: {
		label: 'Username',
		description: 'Shorthand name by which the user wishes to be referred to'
	},
	roles: { label: 'Roles', description: 'Roles assigned to the user' },
	groups: { label: 'Groups', description: 'Groups the user belongs to' }
};

/** Names of every claim with a description (REQ-JWT-003). */
export const CLAIM_NAMES: readonly string[] = Object.keys(CLAIMS);

/** REQ-JWT-003: description for a claim, undefined for unknown claims. */
export function describeClaim(name: string): string | undefined {
	return Object.hasOwn(CLAIMS, name) ? CLAIMS[name].description : undefined;
}

/** REQ-JWT-003: short human label for a claim, undefined for unknown claims. */
export function claimLabel(name: string): string | undefined {
	return Object.hasOwn(CLAIMS, name) ? CLAIMS[name].label : undefined;
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
	openid: 'Sign-in with OpenID Connect: an ID token is returned',
	profile: 'Basic profile claims: name, picture, locale…',
	email: 'email and email_verified claims',
	address: 'address claim',
	phone: 'phone_number and phone_number_verified claims',
	offline_access: 'A refresh token usable while the user is not present'
};

/** RFC 8176 §2. */
const AMR_DESCRIPTIONS: Record<string, string> = {
	face: 'Facial recognition',
	fpt: 'Fingerprint',
	geo: 'Geolocation',
	hwk: 'Proof of possession of a hardware-secured key',
	iris: 'Iris scan',
	kba: 'Knowledge-based authentication',
	mca: 'Multiple-channel authentication',
	mfa: 'Multiple-factor authentication',
	otp: 'One-time password',
	pin: 'Personal identification number',
	pop: 'Proof of possession of a key',
	pwd: 'Password',
	rba: 'Risk-based authentication',
	retina: 'Retina scan',
	sc: 'Smart card',
	sms: 'Confirmation by SMS',
	swk: 'Proof of possession of a software-secured key',
	tel: 'Confirmation by telephone call',
	user: 'User presence test',
	vbm: 'Voice biometric',
	wia: 'Windows integrated authentication'
};

const VERIFIED_FLAGS = ['email_verified', 'phone_number_verified'];

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

/** REQ-JWT-011: the value as copied, strings verbatim, everything else compact JSON. */
export function rawClaimValue(value: unknown): string {
	return typeof value === 'string' ? value : JSON.stringify(value);
}

export type BadgeVariant = 'neutral' | 'success' | 'danger' | 'warning';

export interface ClaimListItem {
	value: string;
	description?: string;
}

export type ClaimView =
	| { kind: 'text'; text: string }
	| {
			kind: 'date';
			iso: string;
			readable: string;
			badge: { variant: BadgeVariant; text: string };
	  }
	| { kind: 'list'; items: ClaimListItem[] }
	| { kind: 'flag'; verified: boolean }
	| { kind: 'json'; json: string };

function listOf(values: string[], descriptions?: Record<string, string>): ClaimView {
	return {
		kind: 'list',
		items: values.map((value) => {
			const description =
				descriptions && Object.hasOwn(descriptions, value) ? descriptions[value] : undefined;
			return description === undefined ? { value } : { value, description };
		})
	};
}

function dateView(
	name: string,
	value: number,
	date: ClaimDate,
	now: number,
	locale: string | undefined
): ClaimView {
	const future = value * 1000 >= now;
	let badge: { variant: BadgeVariant; text: string };
	if (name === 'exp' && future) badge = { variant: 'success', text: `expires ${date.relative}` };
	else if (name === 'exp') badge = { variant: 'danger', text: date.relative };
	else if (name === 'nbf' && future) badge = { variant: 'warning', text: `valid ${date.relative}` };
	else badge = { variant: 'neutral', text: date.relative };
	const readable = new Intl.DateTimeFormat(locale, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).format(value * 1000);
	return { kind: 'date', iso: date.iso, readable, badge };
}

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((el) => typeof el === 'string');

/** REQ-JWT-004/010: how a claim value is displayed. */
export function viewClaim(
	name: string,
	value: unknown,
	now: number = Date.now(),
	locale?: string
): ClaimView {
	const date = formatClaimDate(value, name, now);
	if (date) return dateView(name, value as number, date, now, locale);

	if ((name === 'scope' || name === 'scp') && typeof value === 'string') {
		const scopes = value.split(/\s+/).filter(Boolean);
		return scopes.length > 0 ? listOf(scopes, SCOPE_DESCRIPTIONS) : { kind: 'text', text: value };
	}
	if (name === 'scp' && isStringArray(value)) return listOf(value, SCOPE_DESCRIPTIONS);
	if (name === 'amr' && isStringArray(value)) return listOf(value, AMR_DESCRIPTIONS);
	if (VERIFIED_FLAGS.includes(name) && typeof value === 'boolean')
		return { kind: 'flag', verified: value };
	if (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((el) => ['string', 'number', 'boolean'].includes(typeof el))
	)
		return listOf(value.map(String));
	if (
		(typeof value === 'object' && value !== null && !Array.isArray(value)) ||
		(Array.isArray(value) && value.some((el) => typeof el === 'object' && el !== null))
	)
		return { kind: 'json', json: JSON.stringify(value, null, 2) };
	return { kind: 'text', text: rawClaimValue(value) };
}
