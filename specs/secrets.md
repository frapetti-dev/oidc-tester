# Secrets

Rust commands `secret_set(key, value)`, `secret_get(key) -> Option<String>`, `secret_delete(key)` use the OS keychain.

### REQ-SEC-001 Keychain service and key naming

Status: Accepted

Given a secret operation
When it reaches the keychain
Then it uses `keyring::Entry::new("dev.oidctester.app", key)` with keys `idp:<idpId>:client_secret` and `flow:<flowId>:password`
And a missing entry gives `None` from get and success from delete

### REQ-SEC-002 Secrets never in JSON

Status: Accepted

Given a `SecretField` is blurred with a value
When the workspace is saved
Then the value is stored via `secret_set` and the JSON holds only `hasSecret`/`hasPassword` true
And on `secret_set` failure the error `Could not store secret in OS keychain: <msg>` is shown and the flag stays false

### REQ-SEC-003 Clearing deletes the entry

Status: Accepted

Given a stored secret
When the field is cleared
Then `secret_delete` is called and `hasSecret` becomes false
