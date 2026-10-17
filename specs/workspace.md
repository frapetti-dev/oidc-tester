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
And when deleted, its document directory and every secret key of its clients/flows (`client:<clientId>:client_secret`, `flow:<flowId>:password`) are removed
And the scratchpad cannot be deleted, only cleared

### REQ-WS-006 Invalid file banner, no overwrite

Status: Accepted

Given a workspace file failing zod parsing
When it is loaded
Then the banner `Workspace file is invalid: <zod message>` is shown and the file is not overwritten

### REQ-WS-007 Export excludes secrets

Status: Accepted

Given workspaces with secrets
When exported
Then the file contains `{ format: 'oidc-tester-bundle', version: 1, exportedAt, workspaces: [{ workspace, runs }], settings? }` with `hasSecret` and `hasPassword` forced to false in workspaces and run snapshots, and no secret values

### REQ-WS-008 Import with fresh ids

Status: Accepted

Given a valid export file (`oidc-tester-bundle` v1 or legacy `oidc-tester-workspace` v1)
When imported
Then fresh uuids are assigned to each workspace, its IdPs, clients and flows, runs are re-pointed, an imported scratchpad is named `Scratchpad (imported)`, and the first imported workspace is opened
And an invalid file shows the toast `Not a valid OIDC Tester export file: <reason>`

### REQ-WS-009 IdP, client and flow CRUD with duplicate

Status: Accepted

Given an open workspace
When an IdP, a client or a flow is added, duplicated or deleted (delete after a confirm dialog)
Then the tree updates and duplicates get new ids; `newFlow(type)` uses defaults: scope `openid profile email` (empty for client_credentials), redirectUri `http://localhost:8080/callback`, `cleanSession` false
And selecting a flow loads it in the center pane

### REQ-WS-010 Clients sit between IdP and flows

Status: Accepted

Given an IdP
When a client is added to it
Then `idp.clients` gets `newClient()`: name `New client`, `clientId` empty, `auth` `none`, `jwtAlg` `HS256`, `hasSecret` false, no flows
And every flow lives in exactly one `client.flows`; a flow has no client fields of its own and a run of it uses the `clientId`, `auth`, `jwtAlg` and secret of the client that contains it
And duplicating a client copies its flows and stores copies of its client secret and flow passwords under the new ids
And deleting a client removes its flows and the keychain entries of its client secret and flow passwords
And deleting an IdP removes the same entries for all of its clients
And selecting an IdP selects its first client's first flow, and selecting a client selects its first flow

### REQ-WS-011 Pre-clients files migrate on load

Status: Accepted

Given a workspace document (or run document, or export file) written before clients existed: an IdP with `client` and `flows` and no `clients`, and runs without `clientId`
When it is loaded
Then each such IdP becomes an IdP with one client named `Default client` whose `id` equals the IdP's `id`, carrying the old `client` fields and all of the IdP's `flows`
And each such run gets `clientId` equal to its `idpId` (so its `idpSnapshot`, migrated the same way, contains that client)
And the keychain entry `idp:<idpId>:client_secret` is copied to `client:<idpId>:client_secret` and then deleted, and the migrated workspace document is written back
And a failed keychain copy leaves the document unmigrated on disk so the next load retries it

### REQ-WS-012 Export dialog

Status: Accepted

Given the Export dialog
When it opens
Then it lists every workspace (scratchpad first) with a checkbox, only the current one checked, plus `Include run history` and `Include settings` unchecked
And the confirm button reads `Export N workspace(s)` (`Export 1 workspace`, `Export 2 workspaces`) and is disabled at 0
And on save the default file name is `oidc-tester-<YYYY-MM-DD>.oidcbundle.json`; runs are `[]` when run history is off, `settings` is omitted when settings are off
And success shows the toast `Exported N workspace(s) to <path>`
And the workspace `…` menu `Export…` writes only the current workspace with its runs and no settings, default name `<name>.oidcbundle.json`

### REQ-WS-013 Import preview

Status: Accepted

Given a picked export file
When it parses
Then a dialog `Import workspaces` lists each workspace with a checkbox (all checked) and its IdP and run counts
And if the file has settings, an unchecked `Apply settings from file` checkbox is shown
And confirming `Import N workspace(s)` adds only the checked ones and shows the toast `Imported N workspace(s)`
And when `Apply settings from file` is checked, the settings and theme from the file replace the current ones
