# End-to-end journeys

Playwright `web` (mocked IPC) and `native` (CDP into the Tauri app) against the mock IdP (`pnpm mock-idp`: http :4455, https :4456; user `alice`/`alice-pw`; clients `public-spa`, `conf-basic`/`basic-secret`, `conf-post`/`post-secret`, `conf-jwt`/`jwt-secret`).

### REQ-E2E-001 PKCE happy path with spoofed redirect

Status: Accepted

Given an IdP with issuer `http://localhost:4455`, client `public-spa` and an Auth Code + PKCE flow with redirect `http://spoofed.invalid/cb`
When the run is started and the login (or `mock_auto_approve=1`) completes
Then the Tokens tab shows the decoded id_token with signature status `valid`

### REQ-E2E-002 access_denied error

Status: Accepted

Given the flow has extra auth param `mock_error=access_denied`
When the run is started
Then the Errors tab is shown with the code `access_denied`

### REQ-E2E-003 TLS error and skip-TLS (native)

Status: Accepted

Given an IdP using the https mock `https://localhost:4456` with a self-signed certificate
When the run starts with `tlsInsecure` off
Then the Errors tab shows a `tls` error
And after enabling `tlsInsecure` the run succeeds

### REQ-E2E-004 client_credentials with conf-basic

Status: Accepted

Given client `conf-basic` with secret `basic-secret`, auth `client_secret_basic`, and a client_credentials flow
When the run is started
Then the Tokens tab shows an access token

### REQ-E2E-005 Device flow approve

Status: Accepted

Given a device_code flow against the mock IdP
When the run starts and the `user_code` is approved at `/device`
Then the Tokens tab shows the tokens after polling

### REQ-E2E-006 Scratchpad save-as and relaunch (native)

Status: Accepted

Given IdP content in the scratchpad
When "Save as workspace…" is used with a name and the app is relaunched
Then the named workspace reloads with the content and the scratchpad is empty

### REQ-E2E-007 HAR export

Status: Accepted

Given a finished run
When the HAR export is chosen and saved
Then the saved file is valid JSON with `log.entries` containing the run's exchanges
