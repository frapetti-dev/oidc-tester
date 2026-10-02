# ID token validation

`validateIdToken(payload, header, ctx)` in `src/lib/jwt/idToken.ts` per OIDC Core §3.1.3.7, §3.2.2.11, §3.3.2.12. Each check yields a `validations` row `{ id, level: 'ok'|'warn'|'error', message }`.

### REQ-IDT-001 iss

Status: Accepted

Given an ID token payload
When validated
Then `iss` must equal the IdP issuer, otherwise an `error` row is produced

### REQ-IDT-002 aud

Status: Accepted

Given an ID token payload
When validated
Then `aud` (string or array) must contain the `clientId`, otherwise an `error` row

### REQ-IDT-003 azp

Status: Accepted

Given `aud` has multiple values
When validated
Then `azp` is required and must equal `clientId`, otherwise an `error` row
And with a single audience `azp` is not required

### REQ-IDT-004 exp with 60 s skew

Status: Accepted

Given an `exp` claim
When validated
Then it passes when `exp` > now − 60 s and fails (`error`) otherwise
And a missing `iat` yields an `error` row

### REQ-IDT-005 nonce

Status: Accepted

Given a nonce was sent in the authorize request
When validated
Then `nonce` in the token must equal it, otherwise an `error` row

### REQ-IDT-006 at_hash

Status: Accepted

Given an access token returned from the authorization endpoint (implicit or hybrid)
When validated
Then `at_hash` must equal base64url of the left half of SHA-256/384/512 (chosen by the alg suffix: 256, 384, 512) of the access token
And `at_hash` is required when `response_type` is `id_token token`

### REQ-IDT-007 c_hash

Status: Accepted

Given a hybrid flow with response_type `code id_token`, `code id_token token`
When validated
Then `c_hash` is required and must equal base64url of the left half of the SHA-(256|384|512 by alg suffix) of the `code`
