# Spec tooling

Behavior of `scripts/spec-coverage.ts` (`pnpm spec:check`), which enforces REQ-to-test traceability.

### REQ-TOOL-001 Spec ID collection

Status: Accepted

Given markdown files in `specs/`
When IDs are collected
Then every heading `### REQ-<AREA>-NNN` is returned, where AREA is `[A-Z][A-Z0-9]*` (so `E2E` is valid)
And headings followed by a line `Status: Removed` are skipped
And headings quoted inside prose (not at line start) are ignored

### REQ-TOOL-002 Coverage sources

Status: Accepted

Given a collected ID
When test sources are scanned
Then it is covered by a mention in `src/**/*.{test.ts,stories.svelte,stories.ts}`, `e2e/**/*.spec.ts`, `tests/**/*.test.ts`, `scripts/**/*.test.ts`
And in `src-tauri/src/**/*.rs` as a function named `req_<area>_<nnn>…` (lowercase, underscores)
And uncovered IDs are returned in spec order

### REQ-TOOL-003 Non-test files do not count

Status: Accepted

Given an ID mentioned only in implementation files, docs, or Rust comments
When coverage is computed
Then the ID is reported uncovered

### REQ-TOOL-004 Exact ID matching

Status: Accepted

Given a spec ID `REQ-X-001`
When a test mentions only `REQ-X-0012`
Then `REQ-X-001` stays uncovered

### REQ-TOOL-005 Area restriction

Status: Accepted

Given `--areas=PKCE,HTTP`
When coverage is computed
Then only IDs of those areas count toward total, covered and uncovered

### REQ-TOOL-006 CLI output and exit code

Status: Accepted

Given the CLI is run in a project root
When it finishes
Then it prints the uncovered IDs (if any) and `spec coverage: N/M`
And exits 1 when any ID is uncovered, else 0

### REQ-TOOL-007 Third-party license list

Status: Accepted

Given `pnpm licenses:gen`
When it runs
Then `src/lib/about/licenses.json` holds `{ packages: [{ name, version, license, source: 'npm'|'cargo', homepage: string|null }] }` for production npm dependencies (`pnpm licenses list --prod --json`) and the Rust crates reachable from `oidc-tester` through normal (non-dev, non-build) dependencies for `x86_64-pc-windows-msvc`, excluding `oidc-tester` itself
And entries are sorted by name then version and deduplicated by source+name+version
And a missing license is `UNKNOWN`
