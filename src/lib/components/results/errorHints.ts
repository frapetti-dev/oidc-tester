export const ERROR_HINTS: Record<string, string> = {
	invalid_client:
		'Client authentication failed. Check the client ID, the client secret and the client authentication method.',
	invalid_grant:
		'The code, refresh token or credentials are invalid, expired or already used, or the redirect URI / PKCE verifier does not match the authorization request.',
	unauthorized_client:
		'This client is not allowed to use this grant type or response type. Enable it for the client on the IdP.',
	unsupported_grant_type: 'The IdP does not support this grant type for this client.',
	invalid_scope: 'One or more requested scopes are unknown or not permitted for this client.',
	access_denied: 'The user or the IdP denied the request.',
	invalid_request:
		'The request is missing a parameter, has an invalid value, or is malformed. Check the sent parameters in the Timeline.',
	redirect_uri_mismatch:
		'The redirect URI must exactly match one registered for this client on the IdP (non-standard code, common in practice).',
	state_mismatch:
		'The returned state differs from the one sent. The response may belong to another request, or the IdP altered it.',
	iss_mismatch:
		'The iss parameter in the authorization response differs from the configured issuer (RFC 9207).',
	missing_client_secret:
		'The selected client authentication method needs a client secret. Enter it on the IdP.',
	tls: "Certificate validation failed — enable 'Skip TLS validation' on the IdP to ignore",
	timeout: 'The server did not answer in time. Check connectivity or raise the timeout on the IdP.',
	dns: 'The host name could not be resolved. Check the URL spelling and your network or DNS.',
	connect:
		'The connection was refused or could not be established. Check the host, port and firewall.',
	proxy: 'The proxy could not be used. Check the proxy mode and URL on the IdP.'
};

/** REQ-ERR-002: hint for a known error code, undefined for unknown codes. */
export function hintForError(code: string): string | undefined {
	return Object.hasOwn(ERROR_HINTS, code) ? ERROR_HINTS[code] : undefined;
}
