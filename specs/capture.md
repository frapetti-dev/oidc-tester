# Auth popup capture

The `auth` popup webview navigates to the authorize URL; navigation to the (possibly unresolvable) redirect URI is intercepted in `on_navigation` and never loaded.

### REQ-CAP-001 Popup opens the authorize URL

Status: Accepted

Given `auth_window_open({ url, redirectUri, cleanSession, title })`
When it is invoked
Then a window labelled `auth`, 520x760, centered, parent `main`, loads `url` as an external URL
And an already existing `auth` window is closed first

### REQ-CAP-002 Redirect match rule

Status: Accepted

Given a navigated URL and a `redirectUri`
When `matches_redirect(url, redirect)` is evaluated
Then it is true only when scheme, host (case-insensitive), port (default ports normalized, e.g. `http://h` equals `http://h:80`) and path are all equal
And query and fragment are ignored

### REQ-CAP-003 Navigation cancelled and window closed on capture

Status: Accepted

Given the popup navigates to a URL matching `redirectUri`
When `on_navigation` runs
Then it returns `false` (navigation cancelled), the window is scheduled to close, and `auth_window_open` resolves with `{ kind: "captured", url, navigations }` where `navigations` lists every `{url, at}` seen
And non-matching navigations return `true`

### REQ-CAP-004 User closing the popup cancels the run

Status: Accepted

Given the popup is open and nothing was captured
When the user closes the window
Then `auth_window_open` resolves `{ kind: "closed", navigations }` and the run ends with status `cancelled`

### REQ-CAP-005 Clean session vs persistent profile

Status: Accepted

Given `cleanSession` true or false
When the popup opens
Then false uses the persistent profile `<app_data>/browser-profile`, true uses an isolated session (incognito or temp data directory deleted after close)
And `browser_clear_session()` closes any `auth` window, deletes `<app_data>/browser-profile`, and returns the error string `browser profile in use` if deletion fails
And the IdP editor has a "Clear browser session" button invoking it

### REQ-CAP-006 Custom-scheme redirect warning

Status: Accepted

Given a flow `redirectUri` whose scheme is not `http` or `https` (e.g. `myapp://cb`)
When the redirect URI field is validated
Then the warning `Custom-scheme redirect URIs may not be capturable on this platform; use http(s).` is shown
And no warning is shown for http(s) URIs

### REQ-CAP-007 Popup has no IPC capability

Status: Accepted

Given `src-tauri/capabilities/default.json`
When it is parsed
Then `windows` is exactly `["main"]`, so the `auth` webview cannot call any command
And no other capability file grants permissions to `auth`
