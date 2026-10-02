# Callback parsing

`parseCallback(url, expectedState)` in `src/lib/oauth/callback.ts`.

### REQ-CB-001 Query and fragment parsed, fragment wins

Status: Accepted

Given a captured URL with parameters in query and/or fragment
When `parseCallback` runs
Then it returns `code`, `access_token`, `id_token`, `token_type`, `expires_in`, `scope`, `state`, `error`, `error_description`, `error_uri`, `iss` where present, plus `raw: Record<string,string>` of all parameters
And on a duplicate key the fragment value wins

### REQ-CB-002 State mismatch

Status: Accepted

Given `expectedState` differs from the returned `state` (or it is missing)
When `parseCallback` runs
Then it yields `RunError { source: 'validation', error: 'state_mismatch' }`

### REQ-CB-003 Error parameters become an authorization error

Status: Accepted

Given the callback contains `error` (with optional `error_description`, `error_uri`)
When the engine processes it
Then the run ends with status `error` and `RunError { source: 'authorization', error, error_description, error_uri }`
And no token request is sent

### REQ-CB-004 Issuer mismatch (RFC 9207)

Status: Accepted

Given the callback contains `iss` different from the IdP issuer
When `parseCallback` runs
Then it yields `RunError { source: 'validation', error: 'iss_mismatch' }`
And an absent `iss` or an equal one is accepted
