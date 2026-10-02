use crate::error::AppError;
use std::path::Path;

/// Writes `contents` to a user-chosen path (obtained from the dialog plugin).
pub fn write_text(path: &str, contents: &str) -> Result<(), AppError> {
    std::fs::write(path, contents)
        .map_err(|e| AppError::message(format!("could not write {path}: {e}")))
}

/// Reads a user-chosen UTF-8 text file.
pub fn read_text(path: &str) -> Result<String, AppError> {
    std::fs::read_to_string(Path::new(path))
        .map_err(|e| AppError::message(format!("could not read {path}: {e}")))
}

#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), AppError> {
    write_text(&path, &contents)
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, AppError> {
    read_text(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_text_and_reports_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("export.har");
        let file = file.to_str().unwrap();
        write_text(file, "héllo\n").unwrap();
        assert_eq!(read_text(file).unwrap(), "héllo\n");

        let missing = dir.path().join("missing.txt");
        let err = read_text(missing.to_str().unwrap())
            .unwrap_err()
            .to_string();
        assert!(err.starts_with("could not read "), "{err}");
    }
}
