use crate::http::now_rfc3339;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::oneshot;
use url::Url;

/// Label of the popup webview. It must never appear in a capability file.
pub const AUTH_LABEL: &str = "auth";
/// Name of the persistent browser profile directory inside the app data directory.
pub const PROFILE_DIR: &str = "browser-profile";
const BUSY_PROFILE: &str = "browser profile in use";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthWindowArgs {
    pub url: String,
    pub redirect_uri: Option<String>,
    pub clean_session: bool,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationRecord {
    pub url: String,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AuthWindowResult {
    Captured {
        url: String,
        navigations: Vec<NavigationRecord>,
    },
    Closed {
        navigations: Vec<NavigationRecord>,
    },
}

/// True when `url` is the redirect target: scheme, host (case-insensitive), port (default
/// ports normalized) and path are equal; query and fragment are ignored (REQ-CAP-002).
pub fn matches_redirect(url: &Url, redirect: &Url) -> bool {
    let same_host = match (url.host_str(), redirect.host_str()) {
        (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
        (None, None) => true,
        _ => false,
    };
    url.scheme().eq_ignore_ascii_case(redirect.scheme())
        && same_host
        && url.port_or_known_default() == redirect.port_or_known_default()
        && url.path() == redirect.path()
}

/// Directory of the persistent (non-clean) browser profile.
pub fn profile_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(PROFILE_DIR)
}

/// What the navigation handler must do with a URL.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationDecision {
    /// Let the webview load it.
    Allow,
    /// Cancel the navigation and close the window: the redirect URI was reached.
    Capture,
}

/// Navigation bookkeeping for one popup. The first terminal event (capture or close) wins and
/// resolves the pending `auth_window_open` call exactly once.
pub struct CaptureSession {
    redirect: Option<Url>,
    navigations: Vec<NavigationRecord>,
    sender: Option<oneshot::Sender<AuthWindowResult>>,
}

impl CaptureSession {
    pub fn new(
        redirect_uri: Option<&str>,
        sender: oneshot::Sender<AuthWindowResult>,
    ) -> Result<Self, String> {
        let redirect = match redirect_uri.map(str::trim).filter(|r| !r.is_empty()) {
            Some(raw) => Some(Url::parse(raw).map_err(|e| format!("invalid redirect URI: {e}"))?),
            None => None,
        };
        Ok(Self {
            redirect,
            navigations: Vec::new(),
            sender: Some(sender),
        })
    }

    pub fn is_resolved(&self) -> bool {
        self.sender.is_none()
    }

    pub fn navigations(&self) -> &[NavigationRecord] {
        &self.navigations
    }

    fn is_redirect(&self, url: &Url) -> bool {
        self.redirect
            .as_ref()
            .is_some_and(|redirect| matches_redirect(url, redirect))
    }

    fn capture(&mut self, url: &Url) {
        if let Some(sender) = self.sender.take() {
            let _ = sender.send(AuthWindowResult::Captured {
                url: url.to_string(),
                navigations: self.navigations.clone(),
            });
        }
    }

    /// `on_navigation` hook: records every URL and captures the redirect (REQ-CAP-003).
    pub fn on_navigation(&mut self, url: &Url, at: String) -> NavigationDecision {
        if self.is_resolved() {
            return NavigationDecision::Allow;
        }
        self.navigations.push(NavigationRecord {
            url: url.to_string(),
            at,
        });
        if self.is_redirect(url) {
            self.capture(url);
            NavigationDecision::Capture
        } else {
            NavigationDecision::Allow
        }
    }

    /// `on_page_load(Started)` safety net for redirects that `on_navigation` did not see
    /// (e.g. a fragment carried by a server 302). Records nothing unless it captures.
    pub fn on_page_started(&mut self, url: &Url, at: String) -> NavigationDecision {
        if self.is_resolved() || !self.is_redirect(url) {
            return NavigationDecision::Allow;
        }
        if self
            .navigations
            .last()
            .is_none_or(|n| n.url != url.as_str())
        {
            self.navigations.push(NavigationRecord {
                url: url.to_string(),
                at,
            });
        }
        self.capture(url);
        NavigationDecision::Capture
    }

    /// The window was closed (by the user, `auth_window_close`, or a replacement) before capture.
    pub fn on_closed(&mut self) {
        if let Some(sender) = self.sender.take() {
            let _ = sender.send(AuthWindowResult::Closed {
                navigations: self.navigations.clone(),
            });
        }
    }
}

fn lock(session: &Mutex<CaptureSession>) -> MutexGuard<'_, CaptureSession> {
    session.lock().unwrap_or_else(|e| e.into_inner())
}

fn destroy_auth_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(AUTH_LABEL) {
        let _ = window.destroy();
    }
}

/// Waits (bounded) until the runtime no longer knows the `auth` label.
async fn wait_until_closed(app: &AppHandle) {
    for _ in 0..100 {
        if app.get_webview_window(AUTH_LABEL).is_none() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
}

/// Closing from inside a webview callback would run on the UI thread; hop to the async runtime.
fn schedule_close(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { destroy_auth_window(&app) });
}

#[tauri::command]
pub async fn auth_window_open(
    app: AppHandle,
    args: AuthWindowArgs,
) -> Result<AuthWindowResult, String> {
    let target = Url::parse(&args.url).map_err(|e| format!("invalid authorize URL: {e}"))?;
    let (sender, receiver) = oneshot::channel();
    let session = Arc::new(Mutex::new(CaptureSession::new(
        args.redirect_uri.as_deref(),
        sender,
    )?));

    if app.get_webview_window(AUTH_LABEL).is_some() {
        destroy_auth_window(&app);
        wait_until_closed(&app).await;
    }

    let mut builder = WebviewWindowBuilder::new(&app, AUTH_LABEL, WebviewUrl::External(target))
        .title(&args.title)
        .inner_size(520.0, 760.0)
        .center();
    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main).map_err(|e| e.to_string())?;
    }
    builder = if args.clean_session {
        // WebView2 private mode: no cookies/cache survive the window.
        builder.incognito(true)
    } else {
        let app_data = crate::storage::app_data_dir(&app).map_err(|e| e.to_string())?;
        builder.data_directory(profile_dir(&app_data))
    };

    let navigation_session = session.clone();
    let navigation_app = app.clone();
    let page_session = session.clone();
    let page_app = app.clone();
    let window = builder
        .on_navigation(move |url| {
            let decision = lock(&navigation_session).on_navigation(url, now_rfc3339());
            if decision == NavigationDecision::Capture {
                schedule_close(&navigation_app);
                return false;
            }
            true
        })
        .on_page_load(move |_window, payload| {
            if payload.event() == PageLoadEvent::Started
                && lock(&page_session).on_page_started(payload.url(), now_rfc3339())
                    == NavigationDecision::Capture
            {
                schedule_close(&page_app);
            }
        })
        .build()
        .map_err(|e| format!("could not open auth window: {e}"))?;

    let closed_session = session.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) {
            lock(&closed_session).on_closed();
        }
    });

    match receiver.await {
        Ok(result) => Ok(result),
        Err(_) => Ok(AuthWindowResult::Closed {
            navigations: lock(&session).navigations().to_vec(),
        }),
    }
}

#[tauri::command]
pub async fn auth_window_close(app: AppHandle) -> Result<(), String> {
    destroy_auth_window(&app);
    wait_until_closed(&app).await;
    Ok(())
}

/// Closes the popup and deletes the persistent browser profile (REQ-CAP-005).
#[tauri::command]
pub async fn browser_clear_session(app: AppHandle) -> Result<(), String> {
    destroy_auth_window(&app);
    wait_until_closed(&app).await;
    let app_data = crate::storage::app_data_dir(&app).map_err(|e| e.to_string())?;
    remove_profile(&profile_dir(&app_data), 15, Duration::from_millis(200)).await
}

/// Deletes `dir` (missing is fine). WebView2 releases its files a moment after the window is
/// gone, so deletion is retried before reporting `browser profile in use`.
pub async fn remove_profile(dir: &Path, attempts: u32, delay: Duration) -> Result<(), String> {
    for attempt in 0..attempts.max(1) {
        match std::fs::remove_dir_all(dir) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) if attempt + 1 < attempts => tokio::time::sleep(delay).await,
            Err(_) => {}
        }
    }
    Err(BUSY_PROFILE.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn session(redirect: Option<&str>) -> (CaptureSession, oneshot::Receiver<AuthWindowResult>) {
        let (tx, rx) = oneshot::channel();
        (CaptureSession::new(redirect, tx).unwrap(), rx)
    }

    #[test]
    fn req_cap_002_matches_scheme_host_port_and_path_only() {
        let redirect = url("http://localhost:8080/callback");
        assert!(matches_redirect(
            &url("http://localhost:8080/callback?code=abc&state=x"),
            &redirect
        ));
        assert!(matches_redirect(
            &url("http://localhost:8080/callback#access_token=t"),
            &redirect
        ));
        assert!(matches_redirect(
            &url("http://LOCALHOST:8080/callback"),
            &redirect
        ));
        assert!(!matches_redirect(
            &url("https://localhost:8080/callback"),
            &redirect
        ));
        assert!(!matches_redirect(
            &url("http://localhost:8081/callback"),
            &redirect
        ));
        assert!(!matches_redirect(
            &url("http://localhost:8080/other"),
            &redirect
        ));
        assert!(!matches_redirect(
            &url("http://localhost:8080/callback/"),
            &redirect
        ));
        assert!(!matches_redirect(
            &url("http://example.com:8080/callback"),
            &redirect
        ));
    }

    #[test]
    fn req_cap_002_default_ports_are_normalized() {
        assert!(matches_redirect(
            &url("http://spoofed.invalid:80/cb"),
            &url("http://spoofed.invalid/cb")
        ));
        assert!(matches_redirect(
            &url("http://spoofed.invalid/cb"),
            &url("http://spoofed.invalid:80/cb")
        ));
        assert!(matches_redirect(
            &url("https://spoofed.invalid/cb?x=1"),
            &url("https://spoofed.invalid:443/cb")
        ));
        assert!(!matches_redirect(
            &url("https://spoofed.invalid:80/cb"),
            &url("https://spoofed.invalid/cb")
        ));
        assert!(!matches_redirect(
            &url("http://spoofed.invalid/cb"),
            &url("https://spoofed.invalid/cb")
        ));
    }

    #[test]
    fn req_cap_002_custom_scheme_redirects_compare_host_case_insensitively() {
        let redirect = url("myapp://Callback/done");
        assert!(matches_redirect(
            &url("myapp://callback/done?code=1"),
            &redirect
        ));
        assert!(!matches_redirect(&url("myapp://callback/other"), &redirect));
        assert!(!matches_redirect(
            &url("otherapp://callback/done"),
            &redirect
        ));
    }

    #[test]
    fn req_cap_001_invalid_redirect_uri_is_rejected_and_blank_means_none() {
        let (tx, _rx) = oneshot::channel();
        assert!(CaptureSession::new(Some("not a url"), tx).is_err());
        let (mut s, _rx) = session(Some("  "));
        assert_eq!(
            s.on_navigation(&url("http://anything.example/"), "t".into()),
            NavigationDecision::Allow
        );
        let (mut none, _rx) = session(None);
        assert_eq!(
            none.on_navigation(&url("http://anything.example/"), "t".into()),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn req_cap_001_args_deserialize_from_the_frontend_shape() {
        let args: AuthWindowArgs = serde_json::from_value(json!({
            "url": "https://idp.example/authorize?x=1",
            "redirectUri": "http://spoofed.invalid/cb",
            "cleanSession": true,
            "title": "Sign in"
        }))
        .unwrap();
        assert_eq!(
            args.redirect_uri.as_deref(),
            Some("http://spoofed.invalid/cb")
        );
        assert!(args.clean_session);
        let no_redirect: AuthWindowArgs = serde_json::from_value(json!({
            "url": "https://idp.example/device",
            "redirectUri": null,
            "cleanSession": false,
            "title": "Device"
        }))
        .unwrap();
        assert_eq!(no_redirect.redirect_uri, None);
        assert_eq!(AUTH_LABEL, "auth");
    }

    #[tokio::test]
    async fn req_cap_003_matching_navigation_is_cancelled_and_resolves_captured() {
        let (mut s, rx) = session(Some("http://spoofed.invalid/cb"));
        assert_eq!(
            s.on_navigation(&url("https://idp.example/authorize?a=1"), "t1".into()),
            NavigationDecision::Allow
        );
        assert_eq!(
            s.on_navigation(&url("https://idp.example/login"), "t2".into()),
            NavigationDecision::Allow
        );
        assert!(!s.is_resolved());
        assert_eq!(
            s.on_navigation(
                &url("http://spoofed.invalid/cb?code=abc&state=s#frag"),
                "t3".into()
            ),
            NavigationDecision::Capture
        );
        assert!(s.is_resolved());

        let result = rx.await.unwrap();
        let urls: Vec<&str> = match &result {
            AuthWindowResult::Captured { navigations, .. } => {
                navigations.iter().map(|n| n.url.as_str()).collect()
            }
            other => panic!("expected captured, got {other:?}"),
        };
        assert_eq!(
            urls,
            vec![
                "https://idp.example/authorize?a=1",
                "https://idp.example/login",
                "http://spoofed.invalid/cb?code=abc&state=s#frag"
            ]
        );
        assert_eq!(
            serde_json::to_value(&result).unwrap()["url"],
            "http://spoofed.invalid/cb?code=abc&state=s#frag"
        );

        // After capture further events change nothing.
        assert_eq!(
            s.on_navigation(&url("http://spoofed.invalid/cb"), "t4".into()),
            NavigationDecision::Allow
        );
        s.on_closed();
        assert_eq!(s.navigations().len(), 3);
    }

    #[tokio::test]
    async fn req_cap_003_page_load_fallback_captures_once_without_duplicating_the_navigation() {
        let (mut s, rx) = session(Some("http://spoofed.invalid/cb"));
        s.on_navigation(&url("https://idp.example/authorize"), "t1".into());
        assert_eq!(
            s.on_page_started(&url("https://idp.example/authorize"), "t1".into()),
            NavigationDecision::Allow,
            "non-matching page loads are not recorded twice"
        );
        assert_eq!(
            s.on_page_started(
                &url("http://spoofed.invalid/cb#access_token=t"),
                "t2".into()
            ),
            NavigationDecision::Capture
        );
        match rx.await.unwrap() {
            AuthWindowResult::Captured { url, navigations } => {
                assert_eq!(url, "http://spoofed.invalid/cb#access_token=t");
                assert_eq!(navigations.len(), 2);
            }
            other => panic!("expected captured, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn req_cap_003_result_json_is_tagged_by_kind() {
        let (mut s, rx) = session(Some("http://h/cb"));
        s.on_navigation(&url("http://h/cb?code=1"), "2026-01-01T00:00:00Z".into());
        assert_eq!(
            serde_json::to_value(rx.await.unwrap()).unwrap(),
            json!({
                "kind": "captured",
                "url": "http://h/cb?code=1",
                "navigations": [{ "url": "http://h/cb?code=1", "at": "2026-01-01T00:00:00Z" }]
            })
        );
    }

    #[tokio::test]
    async fn req_cap_004_closing_before_capture_resolves_closed_with_navigations() {
        let (mut s, rx) = session(Some("http://spoofed.invalid/cb"));
        s.on_navigation(&url("https://idp.example/authorize"), "t1".into());
        s.on_closed();
        s.on_closed();
        let result = rx.await.unwrap();
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            json!({
                "kind": "closed",
                "navigations": [{ "url": "https://idp.example/authorize", "at": "t1" }]
            })
        );
        assert!(s.is_resolved());
        assert_eq!(
            s.on_navigation(&url("http://spoofed.invalid/cb"), "t2".into()),
            NavigationDecision::Allow,
            "a closed session never captures"
        );
    }

    #[test]
    fn req_cap_005_persistent_profile_lives_in_app_data_browser_profile() {
        let base = Path::new("C:/Users/x/AppData/Roaming/dev.oidctester.app");
        assert_eq!(profile_dir(base), base.join("browser-profile"));
    }

    #[tokio::test]
    async fn req_cap_005_clearing_deletes_the_profile_and_tolerates_a_missing_one() {
        let root = tempfile::tempdir().unwrap();
        let profile = profile_dir(root.path());
        std::fs::create_dir_all(profile.join("Default")).unwrap();
        std::fs::write(profile.join("Default").join("Cookies"), "x").unwrap();

        remove_profile(&profile, 3, Duration::from_millis(1))
            .await
            .unwrap();
        assert!(!profile.exists());
        remove_profile(&profile, 3, Duration::from_millis(1))
            .await
            .expect("missing profile is fine");
    }

    #[tokio::test]
    async fn req_cap_005_undeletable_profile_reports_browser_profile_in_use() {
        let root = tempfile::tempdir().unwrap();
        // A regular file where the directory should be makes remove_dir_all fail (not NotFound).
        let profile = profile_dir(root.path());
        std::fs::write(&profile, "not a directory").unwrap();
        let err = remove_profile(&profile, 2, Duration::from_millis(1))
            .await
            .unwrap_err();
        assert_eq!(err, "browser profile in use");
    }

    #[test]
    fn req_cap_007_only_the_main_window_has_capabilities() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let mut files = 0;
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|e| e != "json" && e != "toml") {
                continue;
            }
            files += 1;
            let text = std::fs::read_to_string(&path).unwrap();
            let capability: serde_json::Value = if path.extension().unwrap() == "json" {
                serde_json::from_str(&text).unwrap()
            } else {
                continue;
            };
            if path.file_name().unwrap() == "default.json" {
                assert_eq!(capability["windows"], json!(["main"]));
            }
            for key in ["windows", "webviews"] {
                let labels = capability.get(key).and_then(|v| v.as_array());
                for label in labels.into_iter().flatten() {
                    let label = label.as_str().unwrap();
                    assert_ne!(label, AUTH_LABEL, "{path:?} grants {key} to the popup");
                    assert!(!label.contains('*'), "{path:?} uses wildcard label {label}");
                }
            }
            assert!(
                capability.get("remote").is_none(),
                "{path:?} must not grant remote URLs access"
            );
        }
        assert!(files > 0, "no capability files found in {dir:?}");
    }
}
