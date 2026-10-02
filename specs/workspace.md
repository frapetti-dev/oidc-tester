# Workspaces and scratchpad

`WorkspaceStore` in `src/lib/state/workspace.svelte.ts`; documents under `workspaces/<wsId>/workspace.json` (`schemaVersion: 1`).

### REQ-WS-001 Scratchpad auto-created

Status: Accepted

Given no document `workspaces/scratchpad/workspace.json`
When the app starts
Then it is created with id `scratchpad`, name `Scratchpad`, no IdPs, and opened
And an existing scratchpad is not overwritten

### REQ-WS-002 Autosave after 500 ms

Status: Accepted

Given an open workspace
When `current` changes
Then it is written with `doc_write` 500 ms after the last change (debounced), and rapid changes produce one write

### REQ-WS-003 Save as moves scratchpad

Status: Accepted

Given a scratchpad with content
When `saveAs(name)` runs
Then a new workspace with a fresh uuid and that content is stored, the scratchpad is reset to empty, and the new workspace is opened

### REQ-WS-004 Open and list sorted

Status: Accepted

Given several workspaces
When `list()` is called
Then Scratchpad is first, followed by named workspaces sorted by name, and `open(id)` loads and sets `current`

### REQ-WS-005 Rename and delete

Status: Accepted

Given a named workspace
When it is renamed
Then `name` and `updatedAt` change
And when deleted, its document directory and every secret key of its IdPs/flows (`idp:<idpId>:client_secret`, `flow:<flowId>:password`) are removed
And the scratchpad cannot be deleted, only cleared

### REQ-WS-006 Invalid file banner, no overwrite

Status: Accepted

Given a workspace file failing zod parsing
When it is loaded
Then the banner `Workspace file is invalid: <zod message>` is shown and the file is not overwritten

### REQ-WS-007 Export excludes secrets

Status: Accepted

Given a workspace with secrets
When exported
Then the file `<name>.oidcws.json` contains `{ format: 'oidc-tester-workspace', version: 1, workspace, runs }` with `hasSecret` and `hasPassword` forced to false and no secret values

### REQ-WS-008 Import with fresh ids

Status: Accepted

Given a valid export file
When imported
Then fresh uuids are assigned to the workspace, IdPs and flows, runs are re-pointed to them, and the workspace is opened
And an invalid file shows the toast `Not a valid OIDC Tester workspace file: <reason>`

### REQ-WS-009 IdP and flow CRUD with duplicate

Status: Accepted

Given an open workspace
When an IdP or flow is added, duplicated or deleted (delete after a confirm dialog)
Then the tree updates and duplicates get new ids; `newFlow(type)` uses defaults: scope `openid profile email` (empty for client_credentials), redirectUri `http://localhost:8080/callback`, `cleanSession` false
And selecting a flow loads it in the center pane
