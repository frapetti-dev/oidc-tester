# UI shell

### REQ-UI-001 Three-pane layout

Status: Accepted

Given the main window
When `src/routes/+page.svelte` renders
Then a `SplitPane` shows a left `Sidebar`, a center `FlowEditor` and a right `ResultsPanel` with tabs `Tokens`, `Errors`, `Timeline`

### REQ-UI-002 Theme System/Light/Dark

Status: Accepted

Given the `ThemeToggle` with System, Light, Dark
When a choice is made
Then it is stored in `localStorage` key `oidct.theme` and the `dark` class on `<html>` is set for Dark, removed for Light, and follows `prefers-color-scheme` for System
And on load the stored value is applied

### REQ-UI-003 Tokens-only colors

Status: Accepted

Given the `.svelte` files in `src/lib/components` and `src/routes`
When a Vitest test scans them
Then none match `/\b(bg|text|border)-(gray|slate|zinc|neutral|red|green|blue)-\d{2,3}\b/`

### REQ-UI-004 TLS-insecure warning badge

Status: Accepted

Given the IdP editor
When `tlsInsecure` is enabled
Then a red warning badge is shown next to the toggle, and it is hidden when disabled

### REQ-UI-005 Empty states

Status: Accepted

Given no run exists yet
When the Results panel renders
Then it shows the text `No run yet`
And other empty panels show their own empty-state text
