# One multi-workspace export format

All exports use the `oidc-tester-bundle` v1 format: one file holds any number of workspaces, each with optional runs, plus optional settings. The workspace picker in the Export dialog needs multi-workspace files, so a single-workspace format would have forced a second writer. The older `oidc-tester-workspace` v1 format stays import-only because files in that format already exist in the wild and must keep importing; nothing writes it any more.

Secrets are never exported: `hasSecret` and `hasPassword` are forced to false in workspaces and in run snapshots, and the keychain is not read. Imported workspaces always get fresh ids and are added next to existing ones; an import never overwrites.

## Consequences

Run history is opt-in on export because runs can hold access and refresh tokens in plain text.
