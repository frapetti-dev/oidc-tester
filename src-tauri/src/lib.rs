mod auth_window;
mod error;
mod files;
mod http;
mod secrets;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    http::ensure_crypto_provider();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            http::http_send,
            auth_window::auth_window_open,
            auth_window::auth_window_close,
            auth_window::browser_clear_session,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            storage::doc_read,
            storage::doc_write,
            storage::doc_list,
            storage::doc_delete,
            files::write_text_file,
            files::read_text_file,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
