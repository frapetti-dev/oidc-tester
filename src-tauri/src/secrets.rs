use crate::error::AppError;
use keyring::Entry;

/// Keychain service name; keys are `idp:<idpId>:client_secret` and `flow:<flowId>:password`.
pub const SERVICE: &str = "dev.oidctester.app";

fn entry(key: &str) -> Result<Entry, AppError> {
    if key.trim().is_empty() {
        return Err(AppError::message("secret key must not be empty"));
    }
    Entry::new(SERVICE, key).map_err(|e| AppError::message(e.to_string()))
}

pub fn set(key: &str, value: &str) -> Result<(), AppError> {
    entry(key)?
        .set_password(value)
        .map_err(|e| AppError::message(e.to_string()))
}

/// A missing entry is `None`, not an error.
pub fn get(key: &str) -> Result<Option<String>, AppError> {
    match entry(key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::message(e.to_string())),
    }
}

/// Deleting a missing entry succeeds.
pub fn delete(key: &str) -> Result<(), AppError> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::message(e.to_string())),
    }
}

#[tauri::command]
pub async fn secret_set(key: String, value: String) -> Result<(), AppError> {
    set(&key, &value)
}

#[tauri::command]
pub async fn secret_get(key: String) -> Result<Option<String>, AppError> {
    get(&key)
}

#[tauri::command]
pub async fn secret_delete(key: String) -> Result<(), AppError> {
    delete(&key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_key(kind: &str) -> String {
        format!("idp:test-{}:{kind}", uuid::Uuid::new_v4())
    }

    /// Touches the real OS keychain; run with `cargo test -- --ignored secrets`.
    #[test]
    #[ignore = "touches the real Windows Credential Manager"]
    fn req_sec_001_uses_service_and_returns_none_for_missing_entries() {
        let key = unique_key("client_secret");
        assert_eq!(SERVICE, "dev.oidctester.app");
        assert_eq!(get(&key).unwrap(), None);
        delete(&key).expect("deleting a missing entry succeeds");

        set(&key, "s3cret").unwrap();
        assert_eq!(get(&key).unwrap().as_deref(), Some("s3cret"));
        // Same service/key pair is visible through a raw keyring entry.
        let raw = Entry::new("dev.oidctester.app", &key).unwrap();
        assert_eq!(raw.get_password().unwrap(), "s3cret");
        delete(&key).unwrap();
    }

    /// Failures never echo the secret value back to the UI.
    #[test]
    fn req_sec_002_errors_do_not_contain_the_secret_value() {
        let value = "hunter2-very-secret";
        let err = set("", value).expect_err("an empty key is rejected before reaching the store");
        assert!(!err.to_string().contains(value));
        assert!(!err.to_string().is_empty());
    }

    /// Touches the real OS keychain; run with `cargo test -- --ignored secrets`.
    #[test]
    #[ignore = "touches the real Windows Credential Manager"]
    fn req_sec_003_delete_removes_the_entry() {
        let key = unique_key("client_secret");
        set(&key, "to-be-cleared").unwrap();
        delete(&key).unwrap();
        assert_eq!(get(&key).unwrap(), None);
    }
}
