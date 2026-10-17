use serde::Serialize;

use crate::error::AppError;

/// Host facts shown in the About dialog (the TS side adds the app and Tauri versions).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub data_dir: String,
    pub webview_version: String,
    pub os: String,
}

/// `"Windows 10.0.26300 (64-bit)"`; the parenthesis is omitted when the bitness is empty.
fn format_os(os_type: &str, version: &str, bitness: &str) -> String {
    let base = format!("{os_type} {version}");
    if bitness.is_empty() {
        base
    } else {
        format!("{base} ({bitness})")
    }
}

fn bitness_label(bitness: os_info::Bitness) -> &'static str {
    match bitness {
        os_info::Bitness::X64 => "64-bit",
        os_info::Bitness::X32 => "32-bit",
        _ => "",
    }
}

#[tauri::command]
pub fn system_info(app: tauri::AppHandle) -> Result<SystemInfo, AppError> {
    let info = os_info::get();
    Ok(SystemInfo {
        data_dir: crate::storage::app_data_dir(&app)?.display().to_string(),
        webview_version: tauri::webview_version().unwrap_or_else(|_| "unknown".into()),
        os: format_os(
            &info.os_type().to_string(),
            &info.version().to_string(),
            bitness_label(info.bitness()),
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn req_ui_026_os_line_joins_type_version_and_bitness() {
        assert_eq!(
            format_os("Windows", "10.0.26300", "64-bit"),
            "Windows 10.0.26300 (64-bit)"
        );
        assert_eq!(format_os("Windows", "10.0.26300", ""), "Windows 10.0.26300");
    }
}
