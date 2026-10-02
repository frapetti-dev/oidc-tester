import { SignJWT } from 'jose';
import type { Header } from '$lib/ipc/types';
import type { Idp } from '$lib/model/schema';
import type { RunError } from '$lib/model/run';

export type Param = [name: string, value: string];

/** Mutable parts of a token-endpoint style request that client authentication contributes to. */
export interface AuthRequestParts {
	headers: Header[];
	params: Param[];
}

export type ClientAuthResult = ({ ok: true } & AuthRequestParts) | { ok: false; error: RunError };

const JWT_BEARER_ASSERTION = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/** application/x-www-form-urlencoded encoding of a single value (RFC 6749 §2.3.1). */
function formEncode(value: string): string {
	return new URLSearchParams({ v: value }).toString().slice(2);
}

function missingSecret(auth: string): ClientAuthResult {
	return {
		ok: false,
		error: {
			source: 'validation',
			error: 'missing_client_secret',
			error_description: `Client authentication method ${auth} requires a client secret, but none is stored.`
		}
	};
}

/**
 * Adds client authentication to a request: `client_id` / `client_secret` / assertion in the
 * form params, or an `Authorization: Basic` header. Inputs are not mutated.
 * Secret-based methods without a secret fail before anything is sent.
 */
export async function applyClientAuth(
	req: AuthRequestParts,
	client: Idp['client'],
	secret: string | null,
	tokenEndpoint: string,
	now: () => number = Date.now
): Promise<ClientAuthResult> {
	const headers = [...req.headers];
	const params = [...req.params];
	if (client.auth === 'none') {
		params.push(['client_id', client.clientId]);
		return { ok: true, headers, params };
	}
	if (secret === null || secret === '') return missingSecret(client.auth);

	switch (client.auth) {
		case 'client_secret_basic': {
			const credentials = `${formEncode(client.clientId)}:${formEncode(secret)}`;
			headers.push(['Authorization', `Basic ${btoa(credentials)}`]);
			break;
		}
		case 'client_secret_post':
			params.push(['client_id', client.clientId], ['client_secret', secret]);
			break;
		case 'client_secret_jwt': {
			const iat = Math.floor(now() / 1000);
			const assertion = await new SignJWT({})
				.setProtectedHeader({ alg: client.jwtAlg })
				.setIssuer(client.clientId)
				.setSubject(client.clientId)
				.setAudience(tokenEndpoint)
				.setJti(crypto.randomUUID())
				.setIssuedAt(iat)
				.setExpirationTime(iat + 60)
				.sign(new TextEncoder().encode(secret));
			params.push(
				['client_id', client.clientId],
				['client_assertion_type', JWT_BEARER_ASSERTION],
				['client_assertion', assertion]
			);
			break;
		}
	}
	return { ok: true, headers, params };
}
