# Settings

### REQ-SET-001 Persisted settings

Status: Accepted

Given no `settings.json`
When the app loads
Then defaults apply: `timeoutMs 30000`, proxy `system`, TLS validation on, redirect URI `http://localhost:8080/callback`, run history limit `200`
And a change is written to doc `settings.json` within 500 ms
And an invalid `settings.json` shows the toast `Settings file is invalid: <zod message>. Defaults are in use.` and is overwritten only on the next change

### REQ-SET-002 New IdP defaults

Status: Accepted

Given settings with `timeoutMs`, `proxy` and `tlsInsecure` values
When an IdP is added
Then the new IdP copies those values from settings
And existing and duplicated IdPs are unchanged

### REQ-SET-003 New flow redirect URI

Status: Accepted

Given a settings redirect URI
When a flow is added
Then the new flow uses the settings redirect URI

### REQ-SET-004 Run history limit

Status: Accepted

Given a run history limit N greater than 0
When a run finishes in a workspace holding more than N runs
Then the oldest runs beyond N are deleted from storage and from the list
And a limit of 0 keeps all runs

### REQ-SET-005 Data and session

Status: Accepted

Given the Settings dialog
Then the Data and session section shows the data folder path (monospace)
And `Show in Explorer` reveals it
And `Clear auth browser session` calls `browserClearSession` and shows the toast `Auth browser session cleared`
