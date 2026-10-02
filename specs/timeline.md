# Timeline, cURL and HAR

### REQ-TL-001 Merged chronological list

Status: Accepted

Given a run with navigations and exchanges
When `TimelinePanel` renders
Then both are listed in chronological order, navigations as type `NAV`, exchanges with method badge, status, URL and duration
And a type filter hides either kind

### REQ-TL-002 Detail view

Status: Accepted

Given a list entry
When it is clicked
Then request/response headers and bodies are shown, JSON bodies pretty-printed and form bodies as a name/value table

### REQ-TL-003 cURL format

Status: Accepted

Given an exchange and the IdP settings
When `toCurl(exchange, settings)` runs
Then the bash command has `-X METHOD`, one `-H` per header in order, `--data-raw` for the body, with single quotes escaped as `'\''`
And `-k` is added if `tlsInsecure`, `-x <url>` if proxy mode is `url`, `--noproxy '*'` if mode is `none`

### REQ-TL-004 HAR 1.2 structure

Status: Accepted

Given a run
When `toHar(run)` runs
Then `log.version` is `1.2`, `log.creator` is `{ name: 'OIDC Tester', version: <package.json version> }`, `pages` is empty, and there is one entry per exchange with startedDateTime, time, request (with `postData` mimeType/text) and response
And response `content.text` holds the body, with `encoding: 'base64'` when `bodyBase64` is set, and navigations are in the custom field `_navigations`

### REQ-TL-005 HAR save dialog

Status: Accepted

Given the user clicks Export HAR
When the dialog plugin `save` opens
Then it uses `defaultPath: '<flow>-<timestamp>.har'` and filters `[{ name: 'HAR', extensions: ['har'] }]`
And the HAR is written via `write_text_file` with tokens and secrets in plaintext

### REQ-TL-006 Run history list and delete

Status: Accepted

Given past runs of an IdP
When the History list renders
Then it shows date, flow and status per run, each can be opened or deleted, and deletion removes `runs/<runId>.json`
And a per-run selector chooses which run the timeline shows

### REQ-TL-007 Runs persisted with plaintext tokens

Status: Accepted

Given a run finishes
When it is saved
Then `workspaces/<wsId>/runs/<runId>.json` contains the full `Run` including `flowSnapshot`, `idpSnapshot`, exchanges and tokens in plaintext
