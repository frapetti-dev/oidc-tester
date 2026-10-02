# CORS evaluation

`evaluateCors({ origin, method, requestHeaders, preflight?, response })` in `src/lib/oauth/cors.ts` returns `{ allowed, reasons }`. It simulates a browser at `http.origin` and never blocks the real request.

### REQ-CORS-001 ACAO evaluation

Status: Accepted

Given a response and `origin`
When evaluated
Then `Access-Control-Allow-Origin` must equal `origin` or `*`, otherwise `allowed=false` with a reason (missing header or mismatch)

### REQ-CORS-002 Credentials and wildcard

Status: Accepted

Given a credentialed request
When the response has `Access-Control-Allow-Origin: *`
Then `allowed=false` with a reason
And credentialed requests also require `Access-Control-Allow-Credentials: true`

### REQ-CORS-003 Preflight method and headers

Status: Accepted

Given a preflight response
When evaluated
Then `Access-Control-Allow-Methods` must include the method (unless simple) and `Access-Control-Allow-Headers` must include every non-safelisted request header (e.g. `Authorization`, custom headers), case-insensitively, else reasons are listed
And a POST with `application/x-www-form-urlencoded` and only safelisted headers needs no preflight

### REQ-CORS-004 Preflight only when corsCheck and origin

Status: Accepted

Given IdP `corsCheck` and `origin`
When a token request is made
Then an `OPTIONS` preflight precedes it with `Origin`, `Access-Control-Request-Method: POST` and `Access-Control-Request-Headers` as a lowercase sorted list of non-safelisted headers, logged in the timeline
And with `corsCheck` false or empty `origin` no preflight is sent

### REQ-CORS-005 Warning literal, never blocks

Status: Accepted

Given the CORS evaluation finished
When added to `validations`
Then a blocked result is a `warn` row `Browser at <origin> would block this request: <reasons>` and an allowed result is an `ok` row `CORS allowed for <origin>`
And the actual token request is sent regardless
