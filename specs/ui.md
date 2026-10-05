# UI shell

### REQ-UI-001 Three-pane layout

Status: Accepted

Given the main window
When `src/routes/+page.svelte` renders
Then a `SplitPane` shows a left `Sidebar`, a center `FlowEditor` and a right `ResultsPanel` with tabs `Tokens`, `Errors`, `Timeline` when the app is at least 1200px wide (see REQ-UI-006 for narrower widths)

### REQ-UI-002 Theme System/Light/Dark

Status: Accepted

Given the `ThemeToggle` with System, Light, Dark
When a choice is made
Then it is stored in `localStorage` key `oidct.theme` and the `dark` class on `<html>` is set for Dark, removed for Light, and follows `prefers-color-scheme` for System
And on load the stored value is applied
And the toggle is a three-icon segmented control in the titlebar whose accessible names are `System`, `Light`, `Dark`

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
And while the `Network` section is collapsed, its header shows a danger badge `TLS validation off`

### REQ-UI-005 Empty states

Status: Accepted

Given no run exists yet
When the Results panel renders
Then it shows the text `No run yet`
And other empty panels show their own empty-state text

### REQ-UI-006 Adaptive layout

Status: Accepted

Given the app root width
When `layoutMode(width)` is evaluated
Then it returns `wide` when width ≥ 1200 or width is 0 (not measured yet), `medium` when 900 ≤ width < 1200, and `narrow` when width < 900
And in wide mode there are three side-by-side panes
And in medium mode the Sidebar is on the left and the FlowEditor is above the ResultsPanel (horizontal separator)
And in narrow mode the Sidebar is hidden and a titlebar button `Show sidebar` (`aria-expanded`) opens it as a modal drawer
And Escape, the scrim, or selecting an IdP/flow closes the drawer
And the `tauri.conf.json` main window min size is 720×520

### REQ-UI-007 Custom titlebar

Status: Accepted

Given the main window with `decorations: false`
When the titlebar renders
Then it is a drag region (`data-tauri-drag-region`), double-click toggles maximize
And buttons `Minimize`, `Maximize` (`Restore` while maximized) and `Close` call the window API

### REQ-UI-008 Run indicator

Status: Accepted

Given the titlebar
When a run is in progress or has ended
Then its bottom edge has `data-testid="run-indicator"` with `data-state` = `idle` | `running` | `success` | `error`
And `success`/`error` revert to `idle` 2400ms after the run ends
And a `cancelled` run gives `idle`

### REQ-UI-009 Menu widget

Status: Accepted

Given an open menu (`role="menu"` with `menuitem`s)
When the user presses ArrowDown/ArrowUp
Then focus moves with wrap and skips disabled items
And Home/End jump to the first/last enabled item
And Enter/Space activate and close
And Escape/Tab/outside pointerdown close and return focus to the invoker
And `placeMenu` keeps the menu inside the viewport with a 4px margin and flips it left/up when it would overflow

### REQ-UI-010 Default menu replaced

Status: Accepted

Given the app
When the user right-clicks anywhere
Then `preventDefault` is called
And on an enabled text-like `input`/`textarea` a menu offers `Cut`, `Copy`, `Paste`, `Select all`, `Clear`
And `Cut`/`Copy` are disabled for `type=password` and when the selection is empty
And `Cut`/`Paste`/`Clear` are disabled for readonly fields
And `Clear` empties the field and fires `input`
And elsewhere, a non-empty text selection gives a menu with just `Copy`

### REQ-UI-011 Sidebar menus

Status: Accepted

Given the sidebar and the titlebar
When a row is right-clicked, receives the `ContextMenu` key / Shift+F10, or its button `More actions for {name}` is clicked
Then the IdP row menu is `Add flow…`, `Duplicate`, `Rename…`, separator, `Delete…`
And the flow row menu is `Run` (disabled while a run is in progress), `Duplicate`, `Rename…`, separator, `Delete…`
And the titlebar button `Workspace actions` opens `Save as workspace…` (enabled only on the scratchpad), `Rename…` (disabled on the scratchpad), `Export…`, `Import…`, separator, then `Clear scratchpad…` on the scratchpad or `Delete workspace…` otherwise

### REQ-UI-012 Token menus

Status: Accepted

Given the results panel
When a token, claim row, code view or authorize preview is right-clicked
Then the TokenView menu offers `Copy token`, `Copy header JSON`, and `Copy payload JSON` (JWS only; JWE offers header only)
And the claim row menu offers `Copy value` (strings as-is, other values `JSON.stringify`), `Copy claim name`, `Copy as JSON` (`JSON.stringify({ [name]: value })`)
And the CodeView and authorize-preview menus offer `Copy`
And a copy shows status `Copied` or `Could not copy`

### REQ-UI-013 Timeline menus

Status: Accepted

Given the timeline
When an entry or history run is right-clicked
Then the HTTP entry menu is `Copy URL`, `Copy as cURL`, `Copy response body` (disabled when the body is empty), separator, `Save HAR…`
And the navigation entry menu is `Copy URL`, separator, `Save HAR…`
And the history run menu is `Open`, separator, `Delete`

### REQ-UI-014 Bounded, collapsible forms

Status: Accepted

Given the IdP and flow forms
When they render
Then they are at most 44rem wide
And sections are disclosure buttons (`aria-expanded`)
And IdP sections are `Provider`, `Endpoints`, `Client` (open by default) and `Network` (closed by default)
And flow sections are `Request` and `Extra parameters & headers` (open by default) and `Advanced` (closed by default)
And a section is omitted when none of its fields is visible
And open state persists in `localStorage` key `oidct.sections` as a JSON object `{ [sectionId]: boolean }`
And invalid JSON counts as `{}`

### REQ-UI-015 Sticky action bar

Status: Accepted

Given the flow editor
When its content scrolls
Then `Run`/`Cancel` and (front-channel flows) the authorize URL preview with `Copy` sit in a bar stuck to the bottom of the editor's scroll area
And the bar stays in view at any scroll position
