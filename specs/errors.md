# Errors panel

`ErrorsPanel` renders a `RunError`.

### REQ-ERR-001 RunError rendering

Status: Accepted

Given a `RunError`
When the panel renders
Then it shows a source badge (`authorization`, `token`, `network`, `tls`, `validation` or `user`), the `error` code, `error_description`, `error_uri` as a link opened through the opener plugin, the HTTP status, and `detail` in a CodeView
And absent fields are not rendered

### REQ-ERR-002 Hints per code

Status: Accepted

Given an error code in `invalid_client, invalid_grant, unauthorized_client, unsupported_grant_type, invalid_scope, access_denied, invalid_request, redirect_uri_mismatch, state_mismatch, iss_mismatch, missing_client_secret, tls, timeout, dns, connect, proxy`
When the panel renders it
Then a non-empty hint text is shown, and `tls` shows `Certificate validation failed — enable 'Skip TLS validation' on the IdP to ignore`
And an unknown code shows no hint

### REQ-ERR-003 Auto-switch result tabs

Status: Accepted

Given a run finishes
When the Results panel updates
Then it switches to the `Errors` tab if the run has an error and to the `Tokens` tab on success
