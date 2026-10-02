# Authorize URL

`buildAuthorizeUrl(idp, flow, generated)` in `src/lib/oauth/authorize.ts` builds the front-channel request.

### REQ-AUTHZ-001 Required parameters

Status: Accepted

Given an IdP with an authorization endpoint and a flow
When the URL is built
Then it contains `response_type`, `client_id`, `redirect_uri`, `scope`, `state`
And `response_type` defaults are `code` (authorization_code, authorization_code_pkce), `id_token token` (implicit), `code id_token` (hybrid)

### REQ-AUTHZ-002 State auto or fixed

Status: Accepted

Given `state.mode` is `auto` or `fixed`
When the URL is built
Then `auto` yields a fresh `randomToken()` (32 bytes base64url) per run and `fixed` uses `state.value` verbatim

### REQ-AUTHZ-003 Nonce rules

Status: Accepted

Given `nonce.mode` `auto`, `fixed` or `off`
When the URL is built
Then `auto` generates a random nonce, `fixed` uses `nonce.value`, `off` omits `nonce`
And when `response_type` contains `id_token` and mode is `off`, building fails with validation error `nonce is required for response_type containing id_token`

### REQ-AUTHZ-004 Optional OIDC parameters

Status: Accepted

Given the flow sets `prompt`, `loginHint`, `maxAge`, `acrValues`, `uiLocales`, `claims`
When the URL is built
Then non-empty values appear as `prompt`, `login_hint`, `max_age`, `acr_values`, `ui_locales`, `claims`, and empty values are omitted
And `response_mode` is added only when `responseMode` is not empty

### REQ-AUTHZ-005 Extra params override built-ins

Status: Accepted

Given enabled `extraAuthParams` rows, one named like a built-in parameter
When the URL is built
Then all enabled rows are appended and a same-name row replaces the built-in value
And disabled rows are ignored

### REQ-AUTHZ-006 Existing endpoint query preserved

Status: Accepted

Given an authorization endpoint such as `https://idp/authorize?tenant=a`
When the URL is built
Then `tenant=a` remains in the query alongside the generated parameters

### REQ-AUTHZ-007 response_mode options

Status: Accepted

Given the response mode selector
When options are listed
Then they are default (omit), `query` and `fragment`, and `form_post` is not offered

### REQ-AUTHZ-008 Live URL preview

Status: Accepted

Given the flow editor for a front-channel flow
When any field changes
Then a read-only authorize URL preview updates and a copy button copies it to the clipboard
