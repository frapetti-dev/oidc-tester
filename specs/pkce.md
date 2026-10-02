# PKCE

Helpers in `src/lib/oauth/pkce.ts`.

### REQ-PKCE-001 Verifier is 64 unreserved characters

Status: Accepted

Given `generateVerifier()` is called
When the result is inspected
Then it is exactly 64 characters from `A-Z a-z 0-9 - . _ ~`, generated with `crypto.getRandomValues`
And two calls return different values

### REQ-PKCE-002 S256 challenge

Status: Accepted

Given a verifier and method `S256`
When `challenge(verifier, 'S256')` is called
Then it equals base64url (no padding) of SHA-256 of the verifier's ASCII bytes
And for the RFC 7636 appendix B verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` the result is `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`

### REQ-PKCE-003 Plain challenge

Status: Accepted

Given method `plain`
When `challenge(verifier, 'plain')` is called
Then the result equals the verifier

### REQ-PKCE-004 Regenerate

Status: Accepted

Given the PKCE flow editor shows the verifier
When "Regenerate" is clicked
Then a new verifier is generated and the preview `code_challenge` updates accordingly
