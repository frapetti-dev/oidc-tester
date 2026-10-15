# Flows and run engine

`executeRun(ctx) -> Run` in `src/lib/run/engine.ts` orchestrates each `FlowType`. Token requests are `application/x-www-form-urlencoded` with `Accept: application/json`; enabled `extraTokenParams` are appended and override same-name params.

### REQ-FLOW-001 Authorization code exchange

Status: Accepted

Given an `authorization_code` flow
When the popup captures a callback with `code` and matching `state`
Then a POST to the token endpoint is sent with `grant_type=authorization_code`, `code`, `redirect_uri` plus client authentication
And the resulting tokens are stored in `Run.tokens`

### REQ-FLOW-002 PKCE verifier sent

Status: Accepted

Given an `authorization_code_pkce` flow (or hybrid with `usePkce`)
When the authorize URL and token request are built
Then the authorize URL has `code_challenge` and `code_challenge_method` and the token body has `code_verifier` matching that challenge

### REQ-FLOW-003 Implicit makes no token call

Status: Accepted

Given an `implicit` flow
When the popup captures a callback with fragment tokens
Then `access_token`/`id_token` are taken from the fragment, no token endpoint request is made, and `Run.exchanges` contains no token exchange

### REQ-FLOW-004 Hybrid keeps front-channel tokens and exchanges code

Status: Accepted

Given a `hybrid` flow with `responseType` `code id_token`, `code token` or `code id_token token`
When the callback is captured
Then front-channel tokens are kept in `Run.tokens` and the `code` is exchanged at the token endpoint

### REQ-FLOW-005 client_credentials

Status: Accepted

Given a `client_credentials` flow
When the run starts
Then one token request is sent with `grant_type=client_credentials` and optional `scope`, `audience`, `resource` (omitted when empty), and no popup opens

### REQ-FLOW-006 password

Status: Accepted

Given a `password` flow with `username` and the password stored as secret `flow:<flowId>:password`
When the run starts
Then one token request is sent with `grant_type=password`, `username`, `password`, `scope`

### REQ-FLOW-007 refresh_token and use from run

Status: Accepted

Given a `refresh_token` flow with `refreshToken` text
When the run starts
Then one token request is sent with `grant_type=refresh_token`, `refresh_token`, optional `scope`
And the "Use from run…" picker lists runs that have a refresh_token and fills `refreshToken` on selection

### REQ-FLOW-008 Device flow

Status: Accepted

Given a `device_code` flow
When the run starts
Then the device authorization endpoint is POSTed, `user_code`, `verification_uri` and a countdown are shown, and a popup opens at `verification_uri_complete ?? verification_uri` with `redirectUri` null without being awaited
And polling happens every `interval` seconds (default 5) with `grant_type=urn:ietf:params:oauth:grant-type:device_code` and `device_code`
And `authorization_pending` continues, `slow_down` adds 5 s to the interval, `access_denied`, `expired_token` or any other error stops with a `RunError`, success stops with tokens, and reaching `expires_in` stops the run
And on stop `auth_window_close` is called

### REQ-FLOW-009 Token success parsing

Status: Accepted

Given a 2xx JSON response with `access_token`
When it is parsed
Then `Run.tokens` has `access_token`, `id_token`, `refresh_token`, `token_type`, `expires_in`, `scope` and `raw` (the full object), and status is `success`

### REQ-FLOW-010 Token error parsing

Status: Accepted

Given a non-2xx JSON response with `error`
When it is parsed
Then `RunError { source: 'token', error, error_description, error_uri, httpStatus }` is produced
And an `HttpFailure` becomes `RunError { source: 'tls' }` when kind is `tls`, otherwise `source: 'network'`, with `error` = kind and `detail` = message

### REQ-FLOW-011 Non-JSON response

Status: Accepted

Given a token response whose body is not JSON
When it is parsed
Then `RunError { source: 'token', error: 'invalid_response', detail }` where `detail` is the first 2 KB of the body

### REQ-FLOW-012 Single active run and cancel

Status: Accepted

Given a run is in progress
When the UI renders
Then the Run button is disabled and a "Cancel" button is shown
And Cancel calls `auth_window_close`, aborts device polling and ends the run with status `cancelled`

### REQ-FLOW-013 Field matrix visibility

Status: Accepted

Given a selected flow type
When the flow editor renders
Then only the fields of the plan's field matrix for that type are shown (e.g. client_credentials shows scope, audience, resource, extraTokenParams; password shows username, password, scope, extraTokenParams)
And flow-level `headers` is shown for all flows, and `pkceMethod` plus verifier appear only for authorization_code_pkce

### REQ-FLOW-014 UserInfo call

Status: Accepted

Given tokens exist, the flow scope contains `openid` and the userinfo endpoint is set
When the user clicks "Call UserInfo"
Then a GET to the userinfo endpoint is sent with `Authorization: Bearer <access_token>` and the exchange is added to the run
And it is never invoked automatically

### REQ-FLOW-015 Run uses the client that contains the flow

Status: Accepted

Given an IdP with two clients that differ in `clientId`, `auth` and stored secret, each with a flow
When the flow of the second client runs
Then the authorize URL and token request carry the second client's `client_id`, its client authentication and its secret
And `Run.clientId` is the second client's id and `Run.idpSnapshot.clients` holds it
