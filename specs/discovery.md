# Discovery

`discover(issuer, http)` in `src/lib/oauth/discovery.ts` fetches provider metadata and fills IdP endpoints.

### REQ-DISC-001 openid-configuration fetch

Status: Accepted

Given an issuer such as `https://idp.example/realm/`
When `discover` runs
Then it issues GET `https://idp.example/realm/.well-known/openid-configuration` (trailing slash of the issuer removed first) via `sendWithRedirects`
And on a JSON object containing `issuer` it returns the metadata and stores `discovery` and `discoveredAt`

### REQ-DISC-002 RFC 8414 fallback on 404

Status: Accepted

Given the openid-configuration request returns 404
When `discover` continues
Then it GETs `https://host/.well-known/oauth-authorization-server/<issuer-path>` (path insertion)
And both attempts are logged as exchanges

### REQ-DISC-003 Fill empty endpoints only, or Apply all

Status: Accepted

Given discovery metadata with `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, `jwks_uri`, `device_authorization_endpoint`, `end_session_endpoint`
When the result is applied to `endpoints`
Then only empty fields are filled by default
And the "Apply all" button, after an overwrite confirmation, overwrites all fields

### REQ-DISC-004 Issuer mismatch warning

Status: Accepted

Given metadata `issuer` differs from the input issuer after normalizing a trailing slash
When `discover` returns
Then the result carries a warning (not an error) and the metadata is still usable
And equal issuers (modulo trailing slash) produce no warning

### REQ-DISC-005 Unsupported grant or response_type warning

Status: Accepted

Given discovery lists `grant_types_supported` and `response_types_supported`
When the selected flow's grant type or `responseType` is not listed
Then the flow editor shows a warning naming the unsupported value
And no warning appears when the lists are absent or contain the value

### REQ-DISC-006 Discovery errors shown in Errors panel

Status: Accepted

Given discovery fails (network failure, non-JSON body, missing `issuer`, non-2xx)
When the failure is reported
Then a `RunError` is shown in the Errors panel with the cause in `error`/`detail`
And the IdP endpoints are left unchanged
