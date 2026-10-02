use crate::error::AppError;
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Validates a relative, `/`-separated document path and resolves it under `root`.
/// Rejects empty paths, absolute paths and any empty, `.`, `..` segment or segment that
/// contains `\` or `:` (REQ-STORE-002).
pub fn resolve(root: &Path, path: &str) -> Result<PathBuf, AppError> {
    if path.is_empty() {
        return Err(AppError::InvalidPath);
    }
    let mut resolved = root.to_path_buf();
    for segment in path.split('/') {
        let bad = segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.contains('\\')
            || segment.contains(':')
            || segment.contains('\0');
        if bad {
            return Err(AppError::InvalidPath);
        }
        resolved.push(segment);
    }
    Ok(resolved)
}

fn io_error(action: &str, path: &str, e: std::io::Error) -> AppError {
    AppError::message(format!("could not {action} {path}: {e}"))
}

pub fn read(root: &Path, path: &str) -> Result<Option<Value>, AppError> {
    let file = resolve(root, path)?;
    match fs::read(&file) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| AppError::message(format!("invalid JSON in {path}: {e}"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_error("read", path, e)),
    }
}

/// Atomic write: `<file>.tmp` is written and synced, then renamed over the target.
pub fn write(root: &Path, path: &str, value: &Value) -> Result<(), AppError> {
    let file = resolve(root, path)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| io_error("create directory for", path, e))?;
    }
    let mut tmp_name = file.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp = file.with_file_name(tmp_name);
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| AppError::message(format!("could not serialize {path}: {e}")))?;

    let written = fs::File::create(&tmp).and_then(|mut f| {
        f.write_all(&bytes)?;
        f.sync_all()
    });
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(io_error("write", path, e));
    }
    fs::rename(&tmp, &file).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        io_error("replace", path, e)
    })
}

/// File stems of `*.json` files plus names of immediate subdirectories, sorted and
/// de-duplicated. A missing directory is an empty list.
pub fn list(root: &Path, dir: &str) -> Result<Vec<String>, AppError> {
    let directory = resolve(root, dir)?;
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(io_error("list", dir, e)),
    };
    let mut names = BTreeSet::new();
    for entry in entries {
        let entry = entry.map_err(|e| io_error("list", dir, e))?;
        let file_type = entry.file_type().map_err(|e| io_error("list", dir, e))?;
        let path = entry.path();
        if file_type.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                names.insert(name.to_owned());
            }
        } else if path.extension().is_some_and(|ext| ext == "json")
            && let Some(stem) = path.file_stem().and_then(|s| s.to_str())
        {
            names.insert(stem.to_owned());
        }
    }
    Ok(names.into_iter().collect())
}

/// Removes a file or a directory tree; a missing path is not an error.
pub fn delete(root: &Path, path: &str) -> Result<(), AppError> {
    let target = resolve(root, path)?;
    let result = match fs::symlink_metadata(&target) {
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(&target),
        Ok(_) => fs::remove_file(&target),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => Err(e),
    };
    result.map_err(|e| io_error("delete", path, e))
}

/// Environment variable that relocates all app data (documents and browser profile); used by the
/// E2E suite so tests never touch the real profile.
pub const DATA_DIR_ENV: &str = "OIDCT_DATA_DIR";

/// `override_dir` (when non-empty) wins over the OS app-data directory (REQ-STORE-004).
fn resolve_app_data_dir(
    override_dir: Option<String>,
    os_dir: impl FnOnce() -> Result<PathBuf, AppError>,
) -> Result<PathBuf, AppError> {
    match override_dir.filter(|dir| !dir.is_empty()) {
        Some(dir) => Ok(PathBuf::from(dir)),
        None => os_dir(),
    }
}

/// The directory holding documents and the browser profile.
pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    resolve_app_data_dir(std::env::var(DATA_DIR_ENV).ok(), || {
        app.path()
            .app_data_dir()
            .map_err(|e| AppError::message(format!("could not resolve app data directory: {e}")))
    })
}

fn data_root(app: &AppHandle) -> Result<PathBuf, AppError> {
    app_data_dir(app).map(|dir| dir.join("data"))
}

#[tauri::command]
pub async fn doc_read(app: AppHandle, path: String) -> Result<Option<Value>, AppError> {
    read(&data_root(&app)?, &path)
}

#[tauri::command]
pub async fn doc_write(app: AppHandle, path: String, value: Value) -> Result<(), AppError> {
    write(&data_root(&app)?, &path, &value)
}

#[tauri::command]
pub async fn doc_list(app: AppHandle, dir: String) -> Result<Vec<String>, AppError> {
    list(&data_root(&app)?, &dir)
}

#[tauri::command]
pub async fn doc_delete(app: AppHandle, path: String) -> Result<(), AppError> {
    delete(&data_root(&app)?, &path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn req_store_001_write_is_atomic_creates_parents_and_leaves_no_tmp() {
        let root = tempfile::tempdir().unwrap();
        let doc = "workspaces/ws1/workspace.json";

        assert_eq!(read(root.path(), doc).unwrap(), None);

        write(root.path(), doc, &json!({ "a": 1 })).unwrap();
        write(root.path(), doc, &json!({ "a": 2, "b": ["x"] })).unwrap();

        assert_eq!(
            read(root.path(), doc).unwrap(),
            Some(json!({ "a": 2, "b": ["x"] }))
        );
        let dir = root.path().join("workspaces/ws1");
        let names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["workspace.json"], "no .tmp file may remain");
    }

    #[test]
    fn req_store_001_failed_write_keeps_previous_content_and_no_tmp() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "a.json", &json!({ "v": 1 })).unwrap();
        // A directory occupying the target name makes the final rename fail.
        fs::create_dir_all(root.path().join("blocked.json")).unwrap();
        assert!(write(root.path(), "blocked.json", &json!({ "v": 2 })).is_err());
        assert!(!root.path().join("blocked.json.tmp").exists());
        assert_eq!(
            read(root.path(), "a.json").unwrap(),
            Some(json!({ "v": 1 }))
        );
    }

    #[test]
    fn req_store_002_invalid_paths_fail_with_exactly_invalid_path_and_touch_nothing() {
        let root = tempfile::tempdir().unwrap();
        let bad = [
            "",
            "/abs/x.json",
            "C:/x.json",
            "C:x.json",
            "a/../b.json",
            "..",
            "../x.json",
            "a\\b.json",
            "a//b.json",
            "a/b/",
            "./x.json",
            "a/b:c.json",
        ];
        for path in bad {
            let expected = "invalid path";
            let errors = [
                read(root.path(), path).unwrap_err().to_string(),
                write(root.path(), path, &json!(1)).unwrap_err().to_string(),
                list(root.path(), path).unwrap_err().to_string(),
                delete(root.path(), path).unwrap_err().to_string(),
            ];
            for error in errors {
                assert_eq!(error, expected, "path {path:?}");
            }
        }
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
        assert!(resolve(root.path(), "workspaces/ws1/workspace.json").is_ok());
    }

    #[test]
    fn req_store_003_list_returns_json_stems_and_subdirectories() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "dir/b.json", &json!(1)).unwrap();
        write(root.path(), "dir/a.json", &json!(2)).unwrap();
        write(root.path(), "dir/d/inner.json", &json!(3)).unwrap();
        fs::write(root.path().join("dir/c.txt"), "not json").unwrap();

        assert_eq!(list(root.path(), "dir").unwrap(), vec!["a", "b", "d"]);
        assert_eq!(
            list(root.path(), "missing").unwrap(),
            Vec::<String>::new(),
            "a missing directory lists as empty"
        );
    }

    #[test]
    fn req_store_003_list_deduplicates_a_directory_and_json_with_the_same_name() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "dir/x.json", &json!(1)).unwrap();
        write(root.path(), "dir/x/y.json", &json!(2)).unwrap();
        assert_eq!(list(root.path(), "dir").unwrap(), vec!["x"]);
    }

    #[test]
    fn req_store_003_delete_removes_files_and_directories_recursively() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "ws/one/workspace.json", &json!(1)).unwrap();
        write(root.path(), "ws/one/runs/r1.json", &json!(2)).unwrap();
        write(root.path(), "ws/two.json", &json!(3)).unwrap();

        delete(root.path(), "ws/two.json").unwrap();
        assert_eq!(list(root.path(), "ws").unwrap(), vec!["one"]);

        delete(root.path(), "ws/one").unwrap();
        assert!(list(root.path(), "ws").unwrap().is_empty());
        assert_eq!(read(root.path(), "ws/one/runs/r1.json").unwrap(), None);

        delete(root.path(), "ws/never-existed").expect("deleting a missing path succeeds");
    }

    #[test]
    fn req_store_004_data_dir_override_wins_only_when_non_empty() {
        let os_dir = std::path::Path::new("/os/app-data");
        assert_eq!(
            resolve_app_data_dir(Some("/tmp/e2e".into()), || Ok(os_dir.to_path_buf())).unwrap(),
            std::path::PathBuf::from("/tmp/e2e")
        );
        for unset in [None, Some(String::new())] {
            assert_eq!(
                resolve_app_data_dir(unset, || Ok(os_dir.to_path_buf())).unwrap(),
                os_dir
            );
        }
    }
}
