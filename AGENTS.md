# AGENTS.md — OIDC Tester

## Purpose

Windows desktop app (Tauri v2 + SvelteKit + Svelte 5 + Tailwind CSS v4) for testing OAuth2/OIDC flows against any IdP with an arbitrary (spoofed) redirect URI. The redirect never has to resolve: an internal popup webview intercepts the navigation to the redirect URI and captures code/tokens. Features: discovery autofill, all standard flows, per-IdP HTTP settings (headers, CORS origin simulation, TLS validation off, proxy), error display, jwt.io-like decoder with signature and ID-token validation, request timeline with HAR/cURL export, autosaved scratchpad that can be saved as named workspaces.

## Stack & commands

Package manager: **pnpm only** (never npm/npx/yarn/bun; one-off binaries via `pnpm dlx`, local ones via `pnpm exec`). Language: TypeScript (strict). Node 24 runs `.ts` scripts directly: `scripts/` and `tests/mock-idp` use erasable TS syntax only (no enums/namespaces/parameter properties).

| Command                                      | Purpose                                                          |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm dev`                                   | Vite dev server (port 5173, strictPort)                          |
| `pnpm tauri dev` / `pnpm tauri build`        | Run / package the desktop app                                    |
| `pnpm check` / `pnpm lint` / `pnpm format`   | svelte-check / prettier+eslint / prettier write                  |
| `pnpm test:unit`                             | `vitest run` (projects: `server`, `client` browser, `storybook`) |
| `pnpm test:rust`                             | `cargo test --manifest-path src-tauri/Cargo.toml`                |
| `pnpm test:e2e:web` / `pnpm test:e2e:native` | Playwright (mocked IPC / real app over CDP)                      |
| `pnpm mock-idp`                              | Local mock IdP (http :4455, https :4456)                         |
| `pnpm spec:check [--areas=A,B]`              | Every Accepted REQ must be referenced by a test                  |
| `pnpm test`                                  | `test:unit` + `test:rust` + `spec:check`                         |
| `pnpm storybook`                             | Storybook on :6006                                               |

On Windows, cargo lives in `%USERPROFILE%\.cargo\bin`; add it to PATH if a shell cannot find `cargo`.

## Architecture

- **Rust = thin transport only**: HTTP sending, auth popup capture, keychain, JSON file storage, file writes (`src-tauri/src/{http,auth_window,secrets,storage,files,error}.rs`). No OAuth logic in Rust.
- **All OAuth logic is pure TypeScript** (unit-testable): URL building, PKCE, client auth, token requests, callback parsing, discovery, JWT decode/verify, ID-token validation, CORS evaluation, HAR, cURL, device polling.
- The popup webview has **no IPC access**: `src-tauri/capabilities/default.json` lists `"windows": ["main"]` only.
- Custom headers apply to back-channel calls only (discovery, JWKS, token, userinfo, device authorization). The front-channel authorize request gets arbitrary extra query params instead.
- E2E isolation: `OIDCT_DATA_DIR` (REQ-STORE-004) overrides the app data root; native specs launch the debug exe with a temp dir plus `WEBVIEW2_USER_DATA_FOLDER` and a per-launch CDP port, so the real profile and keychain stay untouched. `pnpm test:e2e:native` builds the exe first (`native-build` project); set `E2E_SKIP_BUILD=1` to reuse a fresh `src-tauri/target/debug/oidc-tester.exe`. Web e2e serves `vite dev` on port 15174 with `VITE_E2E=1` (`src/lib/ipc/e2e.ts` forwards IPC to Node).
- reqwest uses `rustls-no-provider` + the ring provider (aws-lc needs NASM), compression features off.
- `response_mode=form_post` is not offered (navigation hook sees URLs only). Offered: `query`, `fragment`, default (omit).
- SPA via adapter-static (`fallback: 'index.html'`), `src/routes/+layout.ts`: `ssr = false`, `prerender = false`. Do not use `base`/`assets`/`resolveRoute` from `$app/paths`.
- Svelte state: classes with runes in `src/lib/state/*.svelte.ts`; no stores. Persisted data validated with `zod` (`src/lib/model/schema.ts`, `schemaVersion: 1`). JWT/crypto via `jose` + WebCrypto.
- Frontend calls Rust only through `src/lib/ipc/commands.ts` (types in `src/lib/ipc/types.ts`), never `invoke` directly.

Folder map:

```
specs/                     requirements (REQ IDs) — source of truth
scripts/                   spec-coverage.ts (+ test)
src/app.css                Tailwind v4 tokens + @utility classes
src/routes/                SPA shell (+page.svelte, +layout.*)
src/lib/components/        ui/ (base components + stories), editors, panels
src/lib/oauth/             discovery, pkce, authorize, callback, clientAuth, tokenRequest, tokenResponse, device, cors, transport
src/lib/jwt/               decode, verify, idToken, claims
src/lib/run/engine.ts      per-flow orchestration producing Run
src/lib/export/            curl.ts, har.ts
src/lib/model/schema.ts    zod schemas + factories
src/lib/state/             rune-based stores
src/lib/ipc/               commands.ts, types.ts, e2e.ts (mockIPC bridge, VITE_E2E=1)
src-tauri/src/             Rust transport
tests/mock-idp/            Node mock IdP; tests/integration/, tests/support/
e2e/web, e2e/native        Playwright journeys
.agents/skills/            project skills; .omp/mcp.json = MCP servers
```

## Spec-driven workflow (mandatory)

1. Find/add the requirement in `specs/*.md` with the next free `REQ-<AREA>-NNN` and Given/When/Then acceptance (exact literals).
2. Write a failing test whose name starts with the REQ ID: `it('REQ-PKCE-002 challenge is base64url SHA-256 of verifier', …)`, Rust `#[test] fn req_http_003_…`, Storybook story `parameters: { req: ['REQ-UI-004'] }` plus the ID in the story name, Playwright `test('REQ-E2E-001 …')`.
3. Run and observe red.
4. Minimal implementation.
5. Green + refactor.
6. `pnpm spec:check` (restrict with `--areas=…` to the areas whose phase is done).
7. Commit.

Never change behavior without changing the spec first. Never delete a REQ: mark it `Status: Removed`. Fixture IDs inside tests must not collide with real ones (use `REQ-FAKEA-001`). See skill `spec-driven-tdd`.

## Styling rules

- Colors/radii/fonts come from semantic tokens in `src/app.css` `@theme` (`surface`, `surface-raised`, `surface-sunken`, `border`, `fg`, `fg-muted`, `accent`, `accent-fg`, `danger`, `success`, `warning`, `info`, `jwt-header`, `jwt-payload`, `jwt-signature`, `method-get`, `method-post`, `font-mono`, `radius-control`). Light/dark via CSS vars; dark mode is the `.dark` class on `<html>`.
- **No raw palette colors** (`bg-gray-800`, `text-red-500`, …) in `.svelte` files under `src/lib/components` and `src/routes` (enforced by a Vitest test, REQ-UI-003).
- Repeated utility groups become `@utility` classes in `src/app.css` (`btn`, `btn-primary`, `input-field`, `panel`, `badge`, `kv-grid`, `code-block`, `tab`, …).
- Theme: System/Light/Dark, persisted in `localStorage` key `oidct.theme`.

## Testing rules

- Pure TS logic (`src/lib/oauth`, `jwt`, `export`, `model`, `run`): Vitest unit `*.test.ts` (node, `server` project).
- Svelte components: Storybook story + play function per state (`*.stories.svelte`); stateful containers (FlowEditor, Sidebar): Vitest browser mode `*.svelte.test.ts` with IPC mocked by `mockIPC`.
- Rust commands: in-module `#[cfg(test)]`, `cargo test`.
- Engine against the mock IdP: `tests/integration`.
- User journeys: Playwright `web` (mocked IPC) and `native` (CDP into WebView2).
- No tests for wiring, forwarding, copies, tautologies, or incidental defaults.

## Tooling: MCP, skills, LSP

- MCP (`.omp/mcp.json`, mirrored in `.mcp.json`): `svelte` (docs + autofixer; run the autofixer on every Svelte file you write) and `tauri` (drive/inspect the running app; requires `tauri-plugin-mcp-bridge`, currently NOT installed because 0.13 does not compile against tauri 2.12 — see skill `tauri-v2`).
- Skills in `.agents/skills/`: `svelte-code-writer`, `svelte-core-bestpractices`, `tauri-v2`, `spec-driven-tdd`. Read the matching skill before touching that area.
- LSP: rust-analyzer, svelteserver, tailwindcss-language-server, typescript-language-server (installed as devDependencies / rustup component).

## Svelte MCP tools

`list-sections` first for Svelte/SvelteKit questions, then `get-documentation` for relevant sections; `svelte-autofixer` until clean; `playground-link` only on user request and never for code written to files.
