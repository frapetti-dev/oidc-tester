import { base64url } from 'jose';
import type { Validation } from '$lib/model/run';

export interface IdTokenContext {
	/** IdP issuer the token must come from. */
	issuer: string;
	clientId: string;
	/** Nonce sent in the authorize request, null when none was sent. */
	nonce: string | null;
	/** Current time in epoch milliseconds (Date.now()); defaults to the real clock. */
	now?: number;
	/** Access token returned from the authorization endpoint (implicit/hybrid) to check at_hash against. */
	accessToken?: string;
	/** Authorization code to check c_hash against (hybrid). */
	code?: string;
	/** at_hash is mandatory (response_type `id_token token`). */
	requireAtHash: boolean;
	/** c_hash is mandatory (hybrid response_type containing `code` and `id_token`). */
	requireCHash: boolean;
}

/** Allowed clock skew for `exp`, in seconds (REQ-IDT-004). */
export const EXP_SKEW_SECONDS = 60;

const SHA_BY_SUFFIX: Record<string, string> = {
	'256': 'SHA-256',
	'384': 'SHA-384',
	'512': 'SHA-512'
};

function row(id: string, level: Validation['level'], message: string): Validation {
	return { id: `idt.${id}`, level, message };
}

function toArray(value: unknown): string[] | null {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
	return null;
}

/** SHA variant for at_hash/c_hash: chosen by the alg suffix; EdDSA (Ed25519) uses SHA-512. */
function hashAlgorithm(alg: unknown): string | null {
	if (typeof alg !== 'string') return null;
	if (alg === 'EdDSA') return 'SHA-512';
	return SHA_BY_SUFFIX[alg.slice(-3)] ?? null;
}

/** Left half of the digest of an ASCII value, base64url without padding (OIDC Core §3.3.2.11). */
async function leftHalfHash(value: string, algorithm: string): Promise<string> {
	const digest = new Uint8Array(
		await crypto.subtle.digest(algorithm, new TextEncoder().encode(value))
	);
	return base64url.encode(digest.subarray(0, digest.length / 2));
}

async function checkHash(
	claim: 'at_hash' | 'c_hash',
	subject: string,
	subjectName: string,
	claimValue: unknown,
	alg: unknown
): Promise<Validation> {
	if (typeof claimValue !== 'string') {
		return row(claim, 'error', `${claim} is missing`);
	}
	const algorithm = hashAlgorithm(alg);
	if (!algorithm) {
		return row(
			claim,
			'error',
			`${claim} cannot be checked: unsupported signing alg ${String(alg)}`
		);
	}
	const expected = await leftHalfHash(subject, algorithm);
	return claimValue === expected
		? row(claim, 'ok', `${claim} matches the ${subjectName}`)
		: row(
				claim,
				'error',
				`${claim} does not match the ${subjectName} (expected ${expected}, got ${claimValue})`
			);
}

/** REQ-IDT-001..007: OIDC Core §3.1.3.7 / §3.2.2.11 / §3.3.2.12 ID token checks. */
export async function validateIdToken(
	payload: Record<string, unknown>,
	header: Record<string, unknown>,
	ctx: IdTokenContext
): Promise<Validation[]> {
	const rows: Validation[] = [];
	const nowSeconds = (ctx.now ?? Date.now()) / 1000;

	// REQ-IDT-001
	if (payload.iss === ctx.issuer)
		rows.push(row('iss', 'ok', `iss matches the issuer ${ctx.issuer}`));
	else {
		const got = typeof payload.iss === 'string' ? payload.iss : 'missing';
		rows.push(row('iss', 'error', `iss ${got} does not match the issuer ${ctx.issuer}`));
	}

	// REQ-IDT-002
	const audiences = toArray(payload.aud);
	if (audiences?.includes(ctx.clientId)) {
		rows.push(row('aud', 'ok', `aud contains the client_id ${ctx.clientId}`));
	} else {
		rows.push(
			row(
				'aud',
				'error',
				`aud ${JSON.stringify(payload.aud ?? null)} does not contain the client_id ${ctx.clientId}`
			)
		);
	}

	// REQ-IDT-003
	if (audiences && audiences.length > 1) {
		if (payload.azp === ctx.clientId) rows.push(row('azp', 'ok', 'azp equals the client_id'));
		else if (payload.azp === undefined) {
			rows.push(row('azp', 'error', 'azp is required when aud has multiple values'));
		} else {
			rows.push(
				row(
					'azp',
					'error',
					`azp ${JSON.stringify(payload.azp)} does not equal the client_id ${ctx.clientId}`
				)
			);
		}
	} else if (payload.azp !== undefined && payload.azp !== ctx.clientId) {
		rows.push(
			row(
				'azp',
				'warn',
				`azp ${JSON.stringify(payload.azp)} does not equal the client_id ${ctx.clientId}`
			)
		);
	} else {
		rows.push(row('azp', 'ok', 'azp is not required for a single audience'));
	}

	// REQ-IDT-004
	if (typeof payload.exp !== 'number') {
		rows.push(row('exp', 'error', 'exp is missing'));
	} else if (payload.exp > nowSeconds - EXP_SKEW_SECONDS) {
		rows.push(row('exp', 'ok', `exp is valid (allowing ${EXP_SKEW_SECONDS} s clock skew)`));
	} else {
		const ago = Math.round(nowSeconds - payload.exp);
		rows.push(
			row(
				'exp',
				'error',
				`ID token expired ${ago} s ago (allowing ${EXP_SKEW_SECONDS} s clock skew)`
			)
		);
	}
	if (typeof payload.iat === 'number') rows.push(row('iat', 'ok', 'iat is present'));
	else rows.push(row('iat', 'error', 'iat is missing'));

	// REQ-IDT-005
	if (ctx.nonce !== null) {
		if (payload.nonce === ctx.nonce) rows.push(row('nonce', 'ok', 'nonce matches the value sent'));
		else {
			const got = typeof payload.nonce === 'string' ? payload.nonce : 'missing';
			rows.push(row('nonce', 'error', `nonce ${got} does not match the value sent (${ctx.nonce})`));
		}
	} else if (payload.nonce !== undefined) {
		rows.push(row('nonce', 'warn', 'ID token contains a nonce but none was sent'));
	} else {
		rows.push(row('nonce', 'ok', 'no nonce was sent, nothing to check'));
	}

	// REQ-IDT-006
	if (ctx.accessToken !== undefined && (payload.at_hash !== undefined || ctx.requireAtHash)) {
		rows.push(
			await checkHash('at_hash', ctx.accessToken, 'access token', payload.at_hash, header.alg)
		);
	} else if (ctx.requireAtHash) {
		rows.push(
			row(
				'at_hash',
				'error',
				payload.at_hash === undefined
					? 'at_hash is required but missing'
					: 'at_hash cannot be checked: no access token from the authorization endpoint'
			)
		);
	}

	// REQ-IDT-007
	if (ctx.code !== undefined && (payload.c_hash !== undefined || ctx.requireCHash)) {
		rows.push(
			await checkHash('c_hash', ctx.code, 'authorization code', payload.c_hash, header.alg)
		);
	} else if (ctx.requireCHash) {
		rows.push(
			row(
				'c_hash',
				'error',
				payload.c_hash === undefined
					? 'c_hash is required but missing'
					: 'c_hash cannot be checked: no authorization code'
			)
		);
	}

	return rows;
}
