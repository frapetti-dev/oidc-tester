---
name: spec-driven-tdd
description: Use when adding or changing any behavior in OIDC Tester — the spec-first, test-first loop with REQ IDs and `pnpm spec:check`.
---

# Spec-driven TDD loop

Never change behavior without changing the spec first. Never delete a requirement; mark it `Status: Removed`.

## Checklist (per requirement)

1. **Spec**: find the requirement in `specs/*.md` or add the next free `REQ-<AREA>-NNN` (heading `### REQ-AREA-NNN Title`, `Status: Accepted`, `Given/When/Then` lines with exact literals).
2. **Failing test** whose name starts with the REQ ID:
   - Vitest: `it('REQ-PKCE-002 challenge is base64url SHA-256 of verifier', …)`
   - Rust: `#[test] fn req_http_003_tls_insecure_accepts_self_signed() {…}`
   - Storybook: story name contains the ID and `parameters: { req: ['REQ-UI-004'] }`
   - Playwright: `test('REQ-E2E-001 …')` in `e2e/**/*.spec.ts`
3. **Run and observe red** (right test, right failure reason). Commands: `pnpm vitest run --project server <path>`, `pnpm test:rust`, `pnpm vitest run --project storybook`.
4. **Minimal implementation** to go green.
5. **Green + refactor** (no behavior change). Also `pnpm check` and `pnpm lint`.
6. **`pnpm spec:check --areas=<AREAs done so far>`** — every Accepted REQ in those areas must be referenced by a test. The final phase runs it without `--areas`.
7. **Commit** (`phase N: <title>` for phase commits).

## Which test type

| Layer                                            | Test                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| `src/lib/oauth`, `jwt`, `export`, `model`, `run` | Vitest unit `*.test.ts` (node env, `server` project)                         |
| Svelte presentational components                 | Storybook story + play function per state                                    |
| Stateful containers (FlowEditor, Sidebar)        | Vitest browser mode `*.svelte.test.ts` (`client` project), IPC via `mockIPC` |
| Rust commands                                    | `cargo test` in-module `#[cfg(test)]`                                        |
| Engine vs mock IdP                               | `tests/integration/*.test.ts`                                                |
| User journeys                                    | Playwright `web` (mocked IPC) and `native` (CDP) in `e2e/`                   |

Do not test wiring, copies, forwarding, tautologies, or incidental defaults. Fixture IDs in tests must never look like real spec IDs (use `REQ-FAKEA-001`).
