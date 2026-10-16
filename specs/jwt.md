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

### REQ-JWT-003 Claim labels and descriptions

Status: Accepted

Given payload claims
When the claims table renders
Then the table has the columns `Claim`, `Label` and `Value` and no `Description` column
And each of `iss, sub, aud, exp, nbf, iat, auth_time, nonce, acr, amr, azp, at_hash, c_hash, sid, jti, scope, scp, client_id, email, email_verified, name, preferred_username, roles, groups` shows a short label in the `Label` column (`scp` → `Scopes`, `exp` → `Expires`) and an info button labelled `About <claim>` next to its name
And hovering or focusing that button shows the description in a tooltip, and Escape or leaving hides it
And unknown claims show an empty label and no info button

### REQ-JWT-004 Date rendering

Status: Accepted

Given numeric date claims (`exp`, `nbf`, `iat`, `auth_time`)
When rendered
Then the value shows a readable local date (weekday, day, month, year, hh:mm:ss) in a `<time>` element whose `datetime` is the ISO local time with offset
And a badge shows the relative time: `exp` in the future `expires in 59 min` (success), `exp` in the past `expired 3 min ago` (danger), `nbf` in the future `valid in 30 sec` (warning), anything else neutral such as `3 min ago` or `in 3 d`
And the relative time refreshes every 30 seconds while the token is shown

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

### REQ-JWT-009 Signature chip hides details until hovered

Status: Accepted

Given a JWS whose signature validation message is `Signature valid (RS256, kid key-1)`
When `TokenView` renders
Then the chip shows only the summary `Signature valid`, and the parenthesized details (`(RS256, kid key-1)`) become visible on hover or keyboard focus
And clicking the chip writes the full message `Signature valid (RS256, kid key-1)` to the clipboard

### REQ-JWT-010 Lists, scopes and structured claim values

Status: Accepted

Given payload claims
When the claims table renders
Then `scope` (space-separated string) and `scp` (string or array of strings) show one list item per scope, in token order
And `openid`, `profile`, `email`, `address`, `phone` and `offline_access` show a description next to the scope; other scopes show none
And `amr` shows one item per method, with the RFC 8176 description for known values
And any other array of strings, numbers or booleans shows one item per element
And objects, and arrays containing objects, show as pretty-printed JSON
And `email_verified` and `phone_number_verified` booleans show a `verified` (success) or `not verified` (warning) badge

### REQ-JWT-011 Copy raw claim value

Status: Accepted

Given a claim row
When the user hovers the row or focuses inside it
Then a button labelled `Copy <claim> value` is visible
And clicking it writes the raw value to the clipboard: strings verbatim, anything else as compact JSON (dates copy the epoch number, `scope` copies the original space-separated string)
And the `Copied` notice appears
