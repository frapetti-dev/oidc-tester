# JWT inspection

Decoding and signature verification in `src/lib/jwt/` and the `TokenView` component.

### REQ-JWT-001 Token kind detection

Status: Accepted

Given a token string
When `inspectToken` runs
Then 3 dot-separated parts decode to `{ kind: 'jws', header, payload, signature, parts }`, 5 parts give `{ kind: 'jwe', header }`, other strings give `{ kind: 'opaque' }`
And a base64url-dotted string that cannot be decoded gives `{ kind: 'malformed', reason }`

### REQ-JWT-002 Color-coded segments and decoded JSON

Status: Accepted

Given a JWS token
When `TokenView` renders
Then the encoded token shows header, payload and signature in `--color-jwt-header`, `--color-jwt-payload`, `--color-jwt-signature`
And decoded header and payload are shown side by side as pretty JSON

### REQ-JWT-003 Claim descriptions

Status: Accepted

Given payload claims
When the claims table renders
Then each of `iss, sub, aud, exp, nbf, iat, auth_time, nonce, acr, amr, azp, at_hash, c_hash, sid, jti, scope, scp, client_id, email, email_verified, name, preferred_username, roles, groups` shows a description, and unknown claims show none

### REQ-JWT-004 Date rendering

Status: Accepted

Given numeric date claims (`exp`, `nbf`, `iat`, `auth_time`)
When rendered
Then they show ISO local time plus a relative text such as `in 59 min` or `expired 3 min ago`

### REQ-JWT-005 Signature verification via JWKS

Status: Accepted

Given a JWS with alg RS*, PS*, ES* or EdDSA and the IdP JWKS
When `verifySignature` runs with `jose.createLocalJWKSet` and `compactVerify`
Then the result is `valid` for a good signature and `invalid` for a tampered one
And `no_key` is returned when no JWKS key matches `kid`/alg

### REQ-JWT-006 HS algorithms use the client secret

Status: Accepted

Given a JWS with alg HS256, HS384 or HS512
When `verifySignature` runs with `{ secret }`
Then the signature is checked with the client secret and yields `valid` or `invalid`

### REQ-JWT-007 alg none is unsigned

Status: Accepted

Given a token with header `alg: none`
When `verifySignature` runs
Then the result is `unsigned` shown at error level

### REQ-JWT-008 JWKS fetch honors HTTP settings

Status: Accepted

Given an IdP with TLS, proxy, headers settings and a `jwks` endpoint
When the JWKS is needed
Then it is fetched once per run via `sendWithRedirects` using those settings, logged in the timeline, and a failed fetch gives result `jwks_unavailable`
