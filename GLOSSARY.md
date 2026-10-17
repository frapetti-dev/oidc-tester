# OIDC Tester

Desktop app for testing OAuth2/OIDC flows against any identity provider and inspecting the tokens that come back.

## Language

**Claim**:
A name/value pair in a decoded JWT payload.
_Avoid_: Field, attribute

**Raw claim value**:
The claim value exactly as it appears in the payload JSON: strings without quotes, everything else as compact JSON.
_Avoid_: Original value, plain value

**Scope**:
A permission name requested at authorization and echoed in the `scope` or `scp` claim.
_Avoid_: Permission, right

**Workspace**:
A named, saved set of IdPs with their clients, flows and run history.
_Avoid_: Project, profile

**Scratchpad**:
The always-present unnamed workspace that autosaves and can be saved as a workspace.
_Avoid_: Draft, temp

**Export file**:
A file holding one or more workspaces, optionally their run history and the settings, never secrets.
_Avoid_: Backup, bundle (in UI text)

**Settings**:
App-wide preferences that apply to new IdPs and flows, run history and appearance; not part of any workspace.
_Avoid_: Options, preferences

**Run history limit**:
The number of most recent runs a workspace keeps.
_Avoid_: Retention

"Options" in the UI is only the name of the titlebar menu, not a domain term; the values it opens are Settings.
