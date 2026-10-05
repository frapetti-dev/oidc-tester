---
name: tauri-v2
description: Use when touching src-tauri: commands, capabilities, plugins, windows, cargo tests
---

# Tauri v2 rules for OIDC Tester

## Principle: Rust is thin transport only

All OAuth/OIDC logic is TypeScript in `src/lib/oauth`, `src/lib/jwt`, etc. Rust only does: HTTP sending, the auth popup capture, keychain, JSON file storage, file writes. Frontend code calls typed wrappers in `src/lib/ipc/commands.ts` (types in `src/lib/ipc/types.ts`), never `invoke` directly. All command payloads are `#[serde(rename_all = "camelCase")]`.

## Commands (modules in `src-tauri/src/`, all registered in `lib.rs`)

- `http.rs`: `http_send(req: HttpRequestSpec) -> Result<HttpExchange, HttpFailure>` — fresh reqwest client per call, no redirect following, TLS-insecure toggle, proxy none/system/url.
- `auth_window.rs`: `auth_window_open(args: AuthWindowArgs) -> Result<AuthWindowResult, String>`, `auth_window_close()`, `browser_clear_session()`. Label `auth`, `on_navigation` captures the redirect URI (`matches_redirect`: scheme, host case-insensitive, port default-normalized, path; query/fragment ignored).
- `secrets.rs`: `secret_set(key, value)`, `secret_get(key) -> Option<String>`, `secret_delete(key)`, service `dev.oidctester.app`.
- `storage.rs`: `doc_read(path) -> Option<Value>`, `doc_write(path, value)`, `doc_list(dir) -> Vec<String>`, `doc_delete(path)`; relative `/` paths only (`invalid path` on empty/absolute/`..`/`\`/`:`); atomic writes.
- `files.rs`: `write_text_file(path, contents)`, `read_text_file(path) -> String` for dialog-chosen paths.

## Capabilities

`src-tauri/capabilities/default.json` lists `"windows": ["main"]` only. The `auth` popup loads untrusted remote pages and MUST have no IPC access. Never add `auth` (or wildcard windows) to a capability.

The main window is frameless (`decorations: false`, min 720×520). The in-app `TitleBar` drives it through `IpcApi.window*` (minimize, toggle maximize, close, is-maximized, resize events). The matching `core:window:allow-*` permissions (minimize, toggle-maximize, internal-toggle-maximize, close, start-dragging) live in the same capability file. The `auth` popup keeps native decorations.

## Plugins

Add official plugins with `pnpm tauri add <plugin>` (updates Cargo.toml, package.json, lib.rs, capability). Installed: opener, dialog. `tauri-plugin-mcp-bridge` 0.13 is NOT installed: it pins `webview2-com-sys` 0.38 and fails to compile against tauri 2.12.1 (wry 0.57 uses 0.39). Retry when a newer bridge release is published (register under `#[cfg(debug_assertions)]`, add `mcp-bridge:default` to the capability).

## Tests and builds

- Rust tests: `pnpm test:rust` (= `cargo test --manifest-path src-tauri/Cargo.toml`). Name tests `req_<area>_<nnn>_<what>` so `pnpm spec:check` finds them. Tests touching the real Credential Manager are `#[ignore]`; run manually: `cargo test -- --ignored secrets`.
- On Windows the shell may lack cargo on PATH; add `%USERPROFILE%\.cargo\bin`.
- `pnpm tauri dev` runs the app (vite on :5173, strictPort). `pnpm tauri build --debug --no-bundle` builds `src-tauri/target/debug/oidc-tester.exe`.

## Tauri MCP server

`.omp/mcp.json` registers `tauri` (`@hypothesi/tauri-mcp-server`). Its webview tools need the bridge plugin (not installed, see above), so for now drive the real app via the Playwright `native` project (CDP) instead. `ipc_*`/window tools become usable once the bridge is installed.
