# UI/UX design

Design reference for the OIDC Tester desktop app. Behavior requirements (with exact literals) live in [`specs/ui.md`](../specs/ui.md) as `REQ-UI-*`; this document explains the intent behind them and where each piece lives. If the two disagree, the spec wins.

## Principles

1. **Signal ink.** Chrome is monochrome ink on cool grey. Color appears only when it carries meaning: JWT parts, status, HTTP methods, danger, keyboard focus. If something is colored and means nothing, remove the color.
2. **Tool, not dashboard.** The user is mid-debug. Dense but legible, no decoration, no marketing surfaces. The one bold element is the titlebar run indicator.
3. **Every width works.** The app must stay usable down to 720x520. Layout adapts to the window instead of scrolling horizontally.
4. **Bounded forms.** Fields never stretch across a wide window. Rarely used settings are collapsed by default and remember how the user left them.
5. **Native feel where it matters.** Own titlebar, own context menus (the WebView2 default menu is suppressed), full keyboard operation, visible focus everywhere, `prefers-reduced-motion` respected.

## Identity

### Color

All colors are semantic tokens defined in `src/app.css` (`:root` for light, `.dark` for dark, exposed to Tailwind through `@theme inline`). Never use raw palette classes (`bg-gray-800`, `text-red-500`); REQ-UI-003 enforces this with a test.

| Group       | Tokens                                        | Meaning                                                                                                                            |
| ----------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces    | `surface`, `surface-raised`, `surface-sunken` | `surface` = window and results sheet, `surface-raised` = editor and cards, `surface-sunken` = hover, code blocks, read-only fields |
| Text        | `fg`, `fg-muted`                              | primary and secondary text                                                                                                         |
| Lines       | `border`                                      | every divider and outline                                                                                                          |
| Action      | `accent`, `accent-fg`                         | primary button. Equals `fg` (ink), so the primary action is the darkest thing on screen                                            |
| Status      | `danger`, `success`, `warning`, `info`        | outcomes, badges, validation                                                                                                       |
| JWT         | `jwt-header`, `jwt-payload`, `jwt-signature`  | decoder segments, and the three run-indicator bars                                                                                 |
| HTTP        | `method-get`, `method-post`                   | method labels in the timeline                                                                                                      |
| Interaction | `focus`, `scrim`                              | focus ring and field focus border; modal and drawer backdrop                                                                       |
| Window      | `window-close`                                | close button hover (the only fixed red)                                                                                            |

Light: surface `#ECEEF2`, raised `#FAFBFC`, ink `#1A1F2B`. Dark: surface `#1B1E25`, raised `#23272F`, ink `#E6E9EF`. Dark mode is the `.dark` class on `<html>`. Theme choice (System / Light / Dark) persists in `localStorage` key `oidct.theme`.

### Type

- UI: Atkinson Hyperlegible Next (variable). Chosen for character disambiguation: `l`/`1`/`I` and `0`/`O` must be distinct in Client IDs and tokens.
- Code, tokens, URLs: Atkinson Hyperlegible Mono (variable).
- Base size 14px, line-height 1.45. Field labels 13px medium, muted. Flow title 20px semibold.
- Fallback chain: Segoe UI Variable Text / Segoe UI / system-ui; Cascadia Mono / Consolas.

### Shape and depth

Radii: `control` 6px (buttons, fields), `menu` 8px, `panel` 10px, `dialog` 12px. One shadow, `shadow-float`, used only on things that float (menus, drawer, dialogs). Everything else is flat and separated by 1px `border` lines.

### Icons

`@lucide/svelte`, imported one icon per file (`@lucide/svelte/icons/<name>`). Icons never carry meaning alone: icon-only buttons have an `aria-label` and usually a `title`.

### Reusable classes

Repeated utility groups are `@utility` classes in `src/app.css`:

| Class                                                            | Use                                                                                             |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `btn`, `btn-primary`, `btn-ghost`, `btn-danger`, `btn-icon`      | 32px buttons; `btn-icon` is a 32px square                                                       |
| `input-field`                                                    | 32px text inputs and selects                                                                    |
| `check-field`, `field-label`                                     | checkbox and field label                                                                        |
| `field-grid`                                                     | one column, two columns once the container is at least `@md`. Used for side-by-side field pairs |
| `panel`, `panel-header`, `badge`, `badge-success/danger/warning` | cards and status chips                                                                          |
| `kv-grid`, `code-block`                                          | key/value editor and monospace blocks                                                           |
| `tab`, `tab-active`                                              | tab strip with a 2px ink underline                                                              |
| `menu`, `menu-item`                                              | context menu surface and rows                                                                   |

## Layout

### Window frame

```
+------------------------------------------------------------------+
| [mark] OIDC Tester | Workspace v  ...  | theme | _  []  X        |  TitleBar (40px, drag region)
|=== run indicator (2px) ===========================================|
| Sidebar        | Flow editor (bounded 44rem)    | Results        |
|                |                                | Tokens/Errors/ |
|                | [sticky bar: preview, Run]     | Timeline       |
+------------------------------------------------------------------+
```

### Adaptive modes (REQ-UI-006)

The mode is derived from the app root's measured width (`layoutMode()` in `src/lib/components/app/layout.ts`).

| Mode     | Width                                          | Layout                                                                                          |
| -------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `wide`   | at least 1200px (also 0, before first measure) | Sidebar, editor and results side by side, three resizable columns                               |
| `medium` | 900 to 1199px                                  | Sidebar on the left; editor above results with a horizontal separator                           |
| `narrow` | below 900px                                    | Sidebar hidden; titlebar button `Show sidebar` opens it as a modal drawer. Editor above results |

Min window size is 720x520 (`tauri.conf.json`). Panes are resized with `SplitPane` separators (1px line, wider invisible hit area, `focus` color on hover/drag/focus; arrow keys, Home and End work on a focused separator).

The drawer (`Drawer.svelte`) sits below the titlebar, closes on Escape, scrim click or selecting an IdP/client/flow, and returns focus to the invoker.

### Sidebar tree (REQ-UI-016)

Hierarchy is carried by structure, not color: three levels differ in weight, size and indent, and a 1px `border` line connects each row's children to it.

| Level  | Row                                                       | Children                         |
| ------ | --------------------------------------------------------- | -------------------------------- |
| IdP    | 14px semibold, `server` icon, groups split by a rule      | clients, indented under the icon |
| Client | 13px medium, `app-window` icon                            | flows, indented under the icon   |
| Flow   | 13px regular, flow type below in mono 11px muted, no icon | none                             |

- **Rounded rows.** Each row is one `radius-control` pill that `surface-sunken` tints on hover and selection, so its action buttons sit inside the tint.
- **One selection mark.** Only the deepest selected row shows the indicator: a 2px `fg` pill inside the row's left edge, on top of the tint. Selected rows keep their action buttons visible.
- **Add buttons (REQ-UI-017).** IdP and client rows show a `+` before `More actions` (hover, focus or selection). `Add client to {idp}` creates a `New client` at once. `Add flow to {client}` opens a menu of flow types; choosing one creates the flow at once. Neither asks for confirmation.
- Icons repeat what the level name says and are `aria-hidden`; the tree keeps `role=tree` with flows as `treeitem`.
- Placeholders `No clients` and `No flows` sit on the containment line of the empty parent.

## Window chrome

The main window is frameless (`decorations: false`). `TitleBar.svelte` provides, left to right: drawer toggle (narrow only), mark and name (name hidden when narrow), workspace switcher, `Workspace actions` menu button, a flexible drag area, theme switch, and Minimize / Maximize-Restore / Close.

- The bar is a drag region; double-click on empty space toggles maximize (REQ-UI-007).
- Window actions go through `IpcApi.window*` only, never Tauri APIs directly from components. Required permissions are in `src-tauri/capabilities/default.json`.
- Trade-off: the Windows 11 Snap Layouts flyout on the Maximize button is lost with a custom titlebar. Accepted.
- The auth popup keeps native decorations; it shows untrusted pages and is not part of this design.

### Run indicator (REQ-UI-008)

A 2px strip on the titlebar's bottom edge, the app's one expressive element.

| State     | Look                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `idle`    | flat `border` color                                                                                         |
| `running` | three bars in the JWT header / payload / signature colors with a surface-colored gap sweeping left to right |
| `success` | all `success`, reverts to idle after 2.4s                                                                   |
| `error`   | all `danger`, reverts to idle after 2.4s                                                                    |

A cancelled run goes straight to idle. With reduced motion the sweep stops and the bars stay static. The strip is `aria-hidden`; run results are announced through the normal results panel.

## Forms (REQ-UI-014, REQ-UI-015)

- **Bounded width.** IdP, client and flow forms are at most 44rem wide. Short fields pair up in `field-grid` (for example Response type + Response mode, Proxy + Timeout).
- **Collapsible sections.** `FormSection.svelte` renders a disclosure button (`aria-expanded`) per group. A section is omitted when none of its fields applies to the current flow type.

  | Form   | Open by default                     | Closed by default |
  | ------ | ----------------------------------- | ----------------- |
  | IdP    | Provider, Endpoints                 | Network           |
  | Client | Client                              |                   |
  | Flow   | Request, Extra parameters & headers | Advanced          |

- **State memory.** Open/closed state is global per section id (not per IdP or flow) and persists in `localStorage` key `oidct.sections` as `{ [sectionId]: boolean }`. Invalid JSON is treated as empty.
- **Closed-section summaries.** A collapsed section keeps important state visible: Network shows a danger badge `TLS validation off`, `{n} headers`, `Origin set`; Advanced shows `{n} set`. Risky settings must never hide silently.
- **Sticky action bar.** In the flow editor, `Run`/`Cancel` and, for front-channel flows, the authorize URL preview with `Copy` sit in a bar pinned to the bottom of the scroll area. The preview is one truncated line, expandable with `Show full URL`. Back-channel flows show no preview.

## Context menus (REQ-UI-009 to 013)

All context menus are in-app HTML, not native menus, so they render above modal dialogs (top-layer popover), match the theme, and are testable. The WebView2 default menu (Reload, Inspect...) is suppressed app-wide.

| Where                           | Items                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------ |
| IdP row                         | Add client, Duplicate, Rename, Delete                                          |
| Client row                      | Duplicate, Rename, Delete                                                      |
| Flow row                        | Run, Duplicate, Rename, Delete                                                 |
| Workspace actions               | Save as workspace, Rename, Export, Import, Clear scratchpad / Delete workspace |
| Token view / claim row          | Copy token, header, payload / value, name, as JSON                             |
| Code blocks, authorize preview  | Copy                                                                           |
| Timeline entry                  | Copy URL, Copy as cURL, Copy response body, Save HAR                           |
| History run                     | Open, Delete                                                                   |
| Text field                      | Cut, Copy, Paste, Select all, Clear (password: no Cut/Copy)                    |
| Anywhere else, with a selection | Copy                                                                           |

Discoverability rules:

- Every right-click menu has a visible equivalent. Sidebar rows reveal a `More actions for {name}` button on hover, focus, or selection that opens the same menu. The `ContextMenu` key and Shift+F10 also open it.
- Destructive items are last, separated, red, and end with an ellipsis where they ask for confirmation.
- Menus behave like a native `role="menu"`: arrow keys with wrap (disabled items skipped), Home/End, Enter/Space activate, Escape/Tab/outside click close and restore focus. The menu is flipped and clamped to stay 4px inside the viewport.
- Copy actions confirm with a brief `Copied` / `Could not copy` status pill at the bottom of the window.

Implementation map: `ui/menu.ts` (types, `placeMenu`), `ui/Menu.svelte` (widget), `ui/contextMenu.ts` (the `menu()` attachment), `ui/editMenu.ts` (text-field items), `ui/ContextMenuHost.svelte` (mounted once at the app root), `state/contextMenu.svelte.ts` (single open menu, notice).

## Results panel

Three tabs: Tokens, Errors, Timeline. The panel uses `surface` while the editor uses `surface-raised`, so results read as a separate sheet.

- **Tokens.** JWTs are split into header / payload / signature, colored with the JWT tokens, and the decoded header and payload sit side by side when the panel is wide enough (container query). Signature and ID-token validation results are listed with status color.
- **Errors.** Protocol errors are shown with hints; the tab is selected automatically after a failed run and Tokens after a later success.
- **Timeline.** One entry per HTTP exchange or navigation, method colored by `method-get` / `method-post`, with cURL and HAR export.

## Accessibility

- Visible focus ring on everything (`:focus-visible`, 2px `focus` outline; fields use a focus border plus ring).
- Targets are 32px high, window controls 46x40.
- Icon-only controls are named (`Show sidebar`, `Workspace actions`, `More actions for {name}`, `Minimize` ...). The theme switch is a radio group with names `System`, `Light`, `Dark`.
- Disclosure sections expose `aria-expanded` / `aria-controls`; the sidebar is a tree with `aria-selected`; menus and drawers use the proper roles and return focus.
- Status (copy notice) is a polite live region. Color is never the only signal: badges carry text, the run indicator is paired with results.
- Motion is limited to short transitions and the run sweep; `prefers-reduced-motion` collapses all of it.

## Working on the UI

- Check [`specs/ui.md`](../specs/ui.md) first; add a requirement before changing behavior.
- Use tokens and the `@utility` classes above. A new repeated utility group becomes a new `@utility`; a new meaning-bearing color becomes a new token in both `:root` and `.dark`.
- Components: Storybook story with a play function per state (`pnpm storybook`); stateful containers get a Vitest browser test (`*.svelte.test.ts`). Browser tests import `src/app.css` and run at 1280x800 (wide).
- Verify visually at roughly 720, 1000 and 1440px wide, in light and dark, before shipping layout changes.
