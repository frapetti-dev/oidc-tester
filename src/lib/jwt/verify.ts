import { compactVerify, createLocalJWKSet, errors, type JSONWebKeySet } from 'jose';
import { inspectToken } from './decode';

export type SignatureStatus = 'valid' | 'invalid' | 'unsigned' | 'no_key' | 'jwks_unavailable';

export interface SignatureResult {
	status: SignatureStatus;
	message: string;
	alg?: string;
	kid?: string;
}

export interface VerifyKeys {
	/** IdP JWKS fetched once per run; null when unavailable. */
	jwks: JSONWebKeySet | null;
	/** Client secret for HS* algorithms. */
	secret: string | null;
}

function failure(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function verifyWithSecret(token: string, alg: string, secret: string) {
	const key = new TextEncoder().encode(secret);
	await compactVerify(token, key, { algorithms: [alg] });
}

async function verifyWithJwks(token: string, alg: string, jwks: JSONWebKeySet) {
	const getKey = createLocalJWKSet(jwks);
	try {
		await compactVerify(token, getKey, { algorithms: [alg] });
	} catch (error) {
		if (!(error instanceof errors.JWKSMultipleMatchingKeys)) throw error;
		// No kid to disambiguate: accept the token if any candidate key verifies it.
		for await (const key of error) {
			try {
				await compactVerify(token, key, { algorithms: [alg] });
				return;
			} catch {
				// try the next candidate
			}
		}
		throw new errors.JWSSignatureVerificationFailed();
	}
}

/** REQ-JWT-005..007: verify a JWS against the IdP JWKS (asymmetric) or the client secret (HS*). */
export async function verifySignature(token: string, keys: VerifyKeys): Promise<SignatureResult> {
	const inspected = inspectToken(token);
	if (inspected.kind !== 'jws') {
		return { status: 'invalid', message: 'Token is not a JWT (JWS), signature cannot be verified' };
	}
	const alg = typeof inspected.header.alg === 'string' ? inspected.header.alg : '';
	const kid = typeof inspected.header.kid === 'string' ? inspected.header.kid : undefined;
	const info = { alg, kid };

	if (alg.toLowerCase() === 'none') {
		return { ...info, status: 'unsigned', message: 'Token is unsigned (alg: none)' };
	}

	try {
		if (alg.startsWith('HS')) {
			if (!keys.secret) {
				return {
					...info,
					status: 'no_key',
					message: `${alg} needs the client secret, none is set`
				};
			}
			await verifyWithSecret(token, alg, keys.secret);
			return { ...info, status: 'valid', message: `Signature valid (${alg}, client secret)` };
		}
		if (!keys.jwks) {
			return { ...info, status: 'jwks_unavailable', message: 'JWKS could not be retrieved' };
		}
		await verifyWithJwks(token, alg, keys.jwks);
		return {
			...info,
			status: 'valid',
			message: `Signature valid (${alg}${kid ? `, kid ${kid}` : ''})`
		};
	} catch (error) {
		if (error instanceof errors.JWKSNoMatchingKey) {
			return {
				...info,
				status: 'no_key',
				message: `No JWKS key matches ${kid ? `kid ${kid} and ` : ''}alg ${alg}`
			};
		}
		return { ...info, status: 'invalid', message: `Signature invalid: ${failure(error)}` };
	}
}
