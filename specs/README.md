# Specs

Requirements for OIDC Tester. Every behavior lives here first; tests are written against these IDs, then code.

## Format

Each requirement is a level-3 heading, a `Status:` line, and Given/When/Then lines (each on its own line, `And` allowed):

```
### REQ-AREA-NNN Short title

Status: Accepted

Given <precondition>
When <action>
Then <observable result>
And <more>
```

## ID rules

- `REQ-<AREA>-<NNN>`: AREA matches `[A-Z][A-Z0-9]*` (listed in the table below, e.g. `E2E`); NNN is a zero-padded 3-digit number.
- IDs are unique across all files and never reused. Take the next free number in the area.
- Never delete a requirement. Mark it `Status: Removed`; coverage tooling then ignores it.

## Statuses

`Draft` (under discussion), `Accepted` (must be covered by tests), `Removed` (retired, kept for history).

## Areas

| File           | AREA  | Topic                           |
| -------------- | ----- | ------------------------------- |
| http.md        | HTTP  | HTTP transport and settings     |
| capture.md     | CAP   | Auth popup redirect capture     |
| discovery.md   | DISC  | Discovery                       |
| authorize.md   | AUTHZ | Authorize URL                   |
| pkce.md        | PKCE  | PKCE                            |
| callback.md    | CB    | Callback parsing                |
| client-auth.md | CAUTH | Client authentication           |
| flows.md       | FLOW  | Flows and run engine            |
| jwt.md         | JWT   | Token inspection and signatures |
| idtoken.md     | IDT   | ID token validation             |
| errors.md      | ERR   | Errors panel                    |
| timeline.md    | TL    | Timeline, cURL, HAR             |
| cors.md        | CORS  | CORS evaluation                 |
| workspace.md   | WS    | Workspaces and scratchpad       |
| secrets.md     | SEC   | Keychain secrets                |
| store.md       | STORE | JSON document storage           |
| ui.md          | UI    | UI shell and theme              |
| e2e.md         | E2E   | End-to-end journeys             |
| tooling.md     | TOOL  | Spec coverage tooling           |
| settings.md    | SET   | Global settings                 |

## Traceability

Every `Accepted` requirement must be referenced by at least one test: the test name (or Storybook story name plus `parameters: { req: [...] }`) carries the REQ ID, e.g. `it('REQ-PKCE-002 challenge is base64url SHA-256 of verifier', …)` or Rust `fn req_http_003_…`. `pnpm spec:check` enforces this and prints `spec coverage: N/N`.
