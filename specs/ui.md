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
And the toggle is a three-option segmented control in the Settings dialog `Appearance` section whose accessible names are `System`, `Light`, `Dark`, each with a visible label

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
And Escape, the scrim, or selecting an IdP/client/flow closes the drawer
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
Then the IdP row menu is `Add client`, `Duplicate`, `Rename…`, separator, `Delete…`
And the client row menu is `Duplicate`, `Rename…`, separator, `Delete…`
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

Given the IdP, client and flow forms
When they render
Then they are at most 44rem wide
And sections are disclosure buttons (`aria-expanded`)
And IdP sections are `Provider`, `Endpoints` (open by default) and `Network` (closed by default)
And client sections are `Client` (open by default)
And flow sections are `Request` and `Extra parameters & headers` (open by default) and `Advanced` (closed by default)
And a section is omitted when none of its fields is visible
And open state persists in `localStorage` key `oidct.sections` as a JSON object `{ [sectionId]: boolean }`
And invalid JSON counts as `{}`

### REQ-UI-015 Sticky action bar

Status: Accepted

Given a front-channel flow in the flow editor
When its content scrolls
Then the authorize URL preview sits in a bar stuck to the bottom of the editor's scroll area
And an icon-only `Copy` button (copy icon, accessible name `Copy`) sits to the left of the URL
And the URL is one truncated line whose `title` (hover tooltip) is the full URL
And there is no `Show full URL` control
And the bar stays in view at any scroll position
And back-channel flows render no bar

### REQ-UI-016 Sidebar tree IdP → client → flow

Status: Accepted

Given a workspace with an IdP that has a client with flows
When the sidebar renders
Then the tree nests IdP rows, then their client rows, then each client's flow rows
And an IdP without clients shows `No clients` and a client without flows shows `No flows`
And selecting a client row opens the client form (`Client ID`, `Client authentication`, `Client secret`) in the editor, and selecting a flow row opens that flow's form
And the IdP form has no client fields

### REQ-UI-017 Add buttons on tree rows

Status: Accepted

Given the sidebar tree
When the user clicks `Add client to {idp}` on an IdP row (next to `More actions for {idp}`)
Then a client named `New client` is created under that IdP and selected, with no confirmation dialog, and the Client tab opens
When the user clicks `Add flow to {client}` on a client row
Then a menu lists every flow type by its label; choosing one creates that flow under the client and selects it, with no confirmation dialog, and the Flow tab opens
And the IdP row shows no counter
And hover and selection tint the whole row with rounded corners; only the deepest selected row shows the accent indicator at its left edge

### REQ-UI-018 Token sub-tabs

Status: Accepted

Given a run with tokens
When the Tokens tab renders
Then the summary (`token_type`, `expires_in`, `scope`) stays above a tab list labelled `Tokens`
And the tab list has, in this order, `Access token`, `ID token`, `Refresh token` (each only when that token was returned), `UserInfo` (only when UserInfo can be called or a UserInfo response exists) and `Raw response` (always)
And only the selected tab's content is shown; the first tab is selected by default
And `Use refresh token` sits in the `Refresh token` tab and `Call UserInfo` in the `UserInfo` tab

### REQ-UI-019 Run in the title row

Status: Accepted

Given the Flow tab of the flow editor
When it renders
Then a `Run` button with a play icon sits at the right end of the title row (the flow name heading), larger than the 32px default button
And while a run is active, `Run` is disabled and a `Cancel` button sits next to it
And the Client and IdP tabs show no `Run` button
And the `Run` button stays in view while the form scrolls

### REQ-UI-020 Results follow the selected flow

Status: Accepted

Given a workspace with flows A and B where A has finished runs and B has none
When the user selects B
Then the Results panel shows `No run yet`
And when the user selects A again it shows A's newest run, or the run last opened from History for A when that run still exists
And a run in progress is shown only while its flow is selected; switching away and back shows it again
And a finished run switches the Results tab (REQ-ERR-003) only when its flow is selected
And opening a History run of another flow selects that flow and opens the Flow editor tab; a run whose flow no longer exists is shown without changing the selection until the next flow switch

### REQ-UI-021 Issuer field explains itself

Status: Accepted

Given the Provider section of the IdP tab
When it renders
Then the issuer textbox is labelled `Issuer URL` with placeholder `https://idp.example/realm`
And a hint below the Discover row reads `Base URL of the identity provider (the iss value), without /.well-known/openid-configuration. Discover reads the provider metadata from it and fills the endpoints below.`
And the textbox is described by that hint (`aria-describedby`)
And the Discover button stays aligned with the textbox, not with the hint

### REQ-UI-022 Indigo accent on interactive chrome

Status: Accepted

Given the light or dark theme
When the app renders
Then `--c-accent` is `#4338ca` in light and `#a5b4fc` in dark, and `--c-focus` equals `--c-accent` in both
And `--c-accent-fg` on `--c-accent` has a contrast ratio of at least 4.5:1 in both themes
And the primary button background, the active tab underline, the selected sidebar row indicator, checked checkboxes and switches, and the selected theme option icon use `accent`

### REQ-UI-023 JSON syntax highlighting

Status: Accepted

Given a code block showing JSON (CodeView with a JSON value, a timeline JSON body, a JSON claim value)
When it renders
Then each token is wrapped in a span with `data-token` set to `key` (object member name incl. quotes), `string`, `number`, `literal` (`true`, `false`, `null`) or `punct` (`{ } [ ] , :`)
And keys, strings, numbers and literals use the `json-key`, `json-string`, `json-number`, `json-literal` color tokens and punctuation uses `fg-muted`; whitespace is unwrapped text
And the block's text content equals the unhighlighted pretty-printed JSON
And non-JSON text in CodeView is shown verbatim without token spans

### REQ-UI-024 Options menu

Status: Accepted

Given the titlebar
Then a button `Options` (`aria-haspopup="menu"`, Lucide `menu` icon) sits directly left of the window buttons and no theme control is in the titlebar
And when it is activated, a menu labelled `Options` opens with `Export…`, `Import…`, a separator, `Settings…`, `About OIDC Tester`

### REQ-UI-025 About dialog

Status: Accepted

Given About
Then it shows the app mark, `OIDC Tester`, `Version <getVersion()>`, the Tauri, WebView2 and OS versions, and the buttons `Copy diagnostics`, `Source code` (opens the repo URL `https://git.infinityreply.dev/f.rapetti/oidc-tester`) and `Report an issue` (opens `<repo>/-/issues`)
And a collapsed `License` section holds the MIT text
And a collapsed `Third-party licenses (<count>)` section has a `Filter packages` field that filters the list by case-insensitive name substring

### REQ-UI-026 Diagnostics text

Status: Accepted

Given the About dialog
When `Copy diagnostics` is activated
Then exactly these lines joined with `\n` are copied: `OIDC Tester <version>`, `Tauri <tauriVersion>`, `WebView2 <webviewVersion>`, `OS <os>`, `Data folder <dataDir>`
And the `Copied` notice is shown
