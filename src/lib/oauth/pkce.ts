const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const VERIFIER_LENGTH = 64;
/** Largest multiple of the alphabet size that fits in a byte; bytes at or above it are rejected (no modulo bias). */
const UNBIASED_LIMIT = 256 - (256 % UNRESERVED.length);

function base64url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7636 §4.1 code verifier: 64 characters from the unreserved set. */
export function generateVerifier(): string {
	let verifier = '';
	while (verifier.length < VERIFIER_LENGTH) {
		const bytes = crypto.getRandomValues(new Uint8Array(VERIFIER_LENGTH * 2));
		for (const byte of bytes) {
			if (byte >= UNBIASED_LIMIT) continue;
			verifier += UNRESERVED[byte % UNRESERVED.length];
			if (verifier.length === VERIFIER_LENGTH) break;
		}
	}
	return verifier;
}

/** RFC 7636 §4.2 code challenge: `S256` is base64url(SHA-256(ASCII verifier)), `plain` is the verifier. */
export async function challenge(verifier: string, method: 'S256' | 'plain'): Promise<string> {
	if (method === 'plain') return verifier;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return base64url(new Uint8Array(digest));
}

/** 32 random bytes as unpadded base64url; used for `state` and `nonce`. */
export function randomToken(): string {
	return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
