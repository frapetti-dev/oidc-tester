use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Client, Method, Proxy, redirect};
use serde::{Deserialize, Serialize};
use std::sync::Once;
use std::time::{Duration, Instant};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyMode {
    None,
    System,
    Url,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySpec {
    pub mode: ProxyMode,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestSpec {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub tls_insecure: bool,
    pub proxy: ProxySpec,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedResponse {
    pub status: u16,
    pub status_text: String,
    pub http_version: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub body_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpExchange {
    pub id: String,
    pub started_at: String,
    pub duration_ms: u64,
    pub request: RecordedRequest,
    pub response: RecordedResponse,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HttpFailureKind {
    InvalidRequest,
    Tls,
    Dns,
    Connect,
    Timeout,
    Proxy,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpFailure {
    pub kind: HttpFailureKind,
    pub message: String,
    pub request: RecordedRequest,
}

/// RFC 3339 timestamp for "now" (UTC).
pub fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// reqwest's `rustls-no-provider` backend needs a process-wide crypto provider; we use ring
/// (aws-lc-sys needs NASM/cmake on Windows, which the toolchain does not require).
pub fn ensure_crypto_provider() {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        // Err means another provider is already installed, which is fine.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// Failure classification inputs, separated from `reqwest::Error` so the mapping is testable.
#[derive(Debug, Clone, Copy)]
pub struct ErrorFacts {
    pub is_timeout: bool,
    pub is_builder: bool,
    pub is_connect: bool,
}

/// Maps error facts plus the lowercased text of the whole `source()` chain to a failure kind
/// (REQ-HTTP-005). Precedence: timeout, builder, tls, proxy, dns, connect, other. With an
/// explicit proxy URL, DNS/connect failures concern the proxy, so they map to `proxy`.
pub fn classify(
    facts: ErrorFacts,
    chain_lowercase: &str,
    proxy_mode: ProxyMode,
) -> HttpFailureKind {
    const TLS_MARKERS: &[&str] = &[
        "certificate",
        "rustls",
        "tls",
        "handshake",
        "invalid peer",
        "unknownissuer",
        "notvalidforname",
    ];
    const DNS_MARKERS: &[&str] = &[
        "dns error",
        "failed to lookup address",
        "no such host",
        "name or service not known",
        "no address associated",
        "nodename nor servname",
        "os error 11001",
        "os error 11004",
    ];
    let has = |markers: &[&str]| markers.iter().any(|m| chain_lowercase.contains(m));

    if facts.is_timeout {
        HttpFailureKind::Timeout
    } else if facts.is_builder {
        HttpFailureKind::InvalidRequest
    } else if has(TLS_MARKERS) {
        HttpFailureKind::Tls
    } else if has(&["proxy", "tunnel"]) || (proxy_mode == ProxyMode::Url && facts.is_connect) {
        HttpFailureKind::Proxy
    } else if has(DNS_MARKERS) {
        if proxy_mode == ProxyMode::Url {
            HttpFailureKind::Proxy
        } else {
            HttpFailureKind::Dns
        }
    } else if facts.is_connect {
        HttpFailureKind::Connect
    } else {
        HttpFailureKind::Other
    }
}

fn error_chain(err: &(dyn std::error::Error + 'static)) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut current: Option<&(dyn std::error::Error + 'static)> = Some(err);
    while let Some(e) = current {
        let text = e.to_string();
        if !parts.contains(&text) {
            parts.push(text);
        }
        current = e.source();
    }
    parts.join(": ")
}

fn failure_from_reqwest(
    err: &reqwest::Error,
    proxy_mode: ProxyMode,
    request: &RecordedRequest,
) -> HttpFailure {
    let message = error_chain(err);
    let kind = classify(
        ErrorFacts {
            is_timeout: err.is_timeout(),
            is_builder: err.is_builder(),
            is_connect: err.is_connect(),
        },
        &message.to_lowercase(),
        proxy_mode,
    );
    HttpFailure {
        kind,
        message,
        request: request.clone(),
    }
}

fn build_client(spec: &HttpRequestSpec) -> Result<Client, (HttpFailureKind, String)> {
    ensure_crypto_provider();
    let mut builder = Client::builder()
        .redirect(redirect::Policy::none())
        .tls_danger_accept_invalid_certs(spec.tls_insecure)
        .tls_danger_accept_invalid_hostnames(spec.tls_insecure);
    if spec.timeout_ms > 0 {
        builder = builder.timeout(Duration::from_millis(spec.timeout_ms));
    }
    builder = match spec.proxy.mode {
        ProxyMode::None => builder.no_proxy(),
        ProxyMode::System => builder,
        ProxyMode::Url => {
            let url = spec
                .proxy
                .url
                .as_deref()
                .filter(|u| !u.trim().is_empty())
                .ok_or((
                    HttpFailureKind::Proxy,
                    "proxy mode is 'url' but no proxy URL was given".to_string(),
                ))?;
            let proxy = Proxy::all(url).map_err(|e| {
                (
                    HttpFailureKind::Proxy,
                    format!("invalid proxy URL: {}", error_chain(&e)),
                )
            })?;
            builder.proxy(proxy)
        }
    };
    builder
        .build()
        .map_err(|e| (HttpFailureKind::Other, error_chain(&e)))
}

fn header_map(headers: &[(String, String)]) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::with_capacity(headers.len());
    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|e| format!("invalid header name {name:?}: {e}"))?;
        let value = HeaderValue::from_str(value)
            .map_err(|e| format!("invalid value for header {name}: {e}"))?;
        map.append(name, value);
    }
    Ok(map)
}

/// Sends one request. Never follows redirects; builds a fresh client per call.
pub async fn send(spec: HttpRequestSpec) -> Result<HttpExchange, Box<HttpFailure>> {
    let recorded = RecordedRequest {
        method: spec.method.clone(),
        url: spec.url.clone(),
        headers: spec.headers.clone(),
        body: spec.body.clone(),
    };
    let fail = |kind: HttpFailureKind, message: String| {
        Box::new(HttpFailure {
            kind,
            message,
            request: recorded.clone(),
        })
    };

    let url = Url::parse(&spec.url)
        .map_err(|e| fail(HttpFailureKind::InvalidRequest, format!("invalid URL: {e}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(fail(
            HttpFailureKind::InvalidRequest,
            format!("unsupported URL scheme: {}", url.scheme()),
        ));
    }
    let method = Method::from_bytes(spec.method.as_bytes()).map_err(|e| {
        fail(
            HttpFailureKind::InvalidRequest,
            format!("invalid method {:?}: {e}", spec.method),
        )
    })?;
    let headers =
        header_map(&spec.headers).map_err(|m| fail(HttpFailureKind::InvalidRequest, m))?;
    let client = build_client(&spec).map_err(|(kind, m)| fail(kind, m))?;

    let mut request = client.request(method, url).headers(headers);
    if let Some(body) = &spec.body {
        request = request.body(body.clone());
    }

    let started_at = now_rfc3339();
    let clock = Instant::now();
    let proxy_mode = spec.proxy.mode;
    let response = request
        .send()
        .await
        .map_err(|e| Box::new(failure_from_reqwest(&e, proxy_mode, &recorded)))?;

    let status = response.status();
    let http_version = format!("{:?}", response.version());
    let response_headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_owned(),
                String::from_utf8_lossy(value.as_bytes()).into_owned(),
            )
        })
        .collect();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| Box::new(failure_from_reqwest(&e, proxy_mode, &recorded)))?;
    let duration_ms = u64::try_from(clock.elapsed().as_millis()).unwrap_or(u64::MAX);

    let (body, body_base64) = match String::from_utf8(bytes.to_vec()) {
        Ok(text) => (text, None),
        Err(e) => (String::new(), Some(STANDARD.encode(e.into_bytes()))),
    };

    Ok(HttpExchange {
        id: uuid::Uuid::new_v4().to_string(),
        started_at,
        duration_ms,
        request: recorded,
        response: RecordedResponse {
            status: status.as_u16(),
            status_text: status.canonical_reason().unwrap_or_default().to_owned(),
            http_version,
            headers: response_headers,
            body,
            body_base64,
        },
    })
}

#[tauri::command]
pub async fn http_send(req: HttpRequestSpec) -> Result<HttpExchange, Box<HttpFailure>> {
    send(req).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use wiremock::matchers::{any, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn spec(method: &str, url: &str) -> HttpRequestSpec {
        HttpRequestSpec {
            method: method.to_owned(),
            url: url.to_owned(),
            headers: Vec::new(),
            body: None,
            tls_insecure: false,
            proxy: ProxySpec {
                mode: ProxyMode::None,
                url: None,
            },
            timeout_ms: 10_000,
        }
    }

    fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
        items
            .iter()
            .map(|(a, b)| ((*a).to_owned(), (*b).to_owned()))
            .collect()
    }

    /// A one-shot raw HTTP server that records the exact bytes of the request head and body.
    async fn raw_server() -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/token", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut buf = [0u8; 1024];
            loop {
                let n = socket.read(&mut buf).await.unwrap();
                received.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&received).into_owned();
                if let Some(head_end) = text.find("\r\n\r\n") {
                    let length = text[..head_end]
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    if received.len() >= head_end + 4 + length || n == 0 {
                        break;
                    }
                } else if n == 0 {
                    break;
                }
            }
            socket
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok")
                .await
                .unwrap();
            socket.shutdown().await.ok();
            String::from_utf8_lossy(&received).into_owned()
        });
        (url, handle)
    }

    #[tokio::test]
    async fn req_http_001_headers_body_and_order_are_forwarded_verbatim() {
        let (url, server) = raw_server().await;
        let mut request = spec("POST", &url);
        request.headers = pairs(&[
            ("X-Zulu", "1"),
            ("Content-Type", "application/x-www-form-urlencoded"),
            ("X-Alpha", "2"),
            ("Origin", "https://app.example"),
            ("X-Dup", "first"),
            ("X-Dup", "second"),
        ]);
        request.body = Some("grant_type=authorization_code&code=a%20b".to_owned());

        let exchange = send(request.clone()).await.expect("request succeeds");

        let raw = server.await.unwrap();
        let head = raw.split("\r\n\r\n").next().unwrap().to_ascii_lowercase();
        let position = |needle: &str| {
            head.find(needle)
                .unwrap_or_else(|| panic!("{needle} in {head}"))
        };
        assert!(
            position("x-zulu: 1") < position("content-type: application/x-www-form-urlencoded")
                && position("content-type:") < position("x-alpha: 2")
                && position("x-alpha: 2") < position("origin: https://app.example")
                && position("origin:") < position("x-dup: first"),
            "header order preserved on the wire: {head}"
        );
        assert!(head.contains("x-dup: first") && head.contains("x-dup: second"));
        assert!(raw.starts_with("POST /token HTTP/1.1\r\n"), "{raw}");
        assert!(raw.ends_with("grant_type=authorization_code&code=a%20b"));

        assert_eq!(exchange.request.method, "POST");
        assert_eq!(exchange.request.url, url);
        assert_eq!(exchange.request.headers, request.headers);
        assert_eq!(exchange.request.body, request.body);
        assert_eq!(exchange.response.status, 200);
        assert_eq!(exchange.response.status_text, "OK");
        assert_eq!(exchange.response.http_version, "HTTP/1.1");
        assert_eq!(exchange.response.body, "ok");
        assert_eq!(exchange.response.body_base64, None);
        assert!(
            exchange
                .response
                .headers
                .contains(&("content-length".to_owned(), "2".to_owned()))
        );
        assert!(OffsetDateTime::parse(&exchange.started_at, &Rfc3339).is_ok());
    }

    #[tokio::test]
    async fn req_http_001_non_utf8_body_is_returned_as_base64() {
        let server = MockServer::start().await;
        Mock::given(any())
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![0xff, 0xfe, 0x00, 0x41]))
            .mount(&server)
            .await;
        let exchange = send(spec("GET", &server.uri())).await.unwrap();
        assert_eq!(exchange.response.body, "");
        assert_eq!(exchange.response.body_base64.as_deref(), Some("//4AQQ=="));
    }

    #[tokio::test]
    async fn req_http_002_redirects_are_not_followed() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/start"))
            .respond_with(
                ResponseTemplate::new(302).insert_header("Location", "http://other.invalid/next"),
            )
            .mount(&server)
            .await;
        Mock::given(path("/next"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;

        let exchange = send(spec("GET", &format!("{}/start", server.uri())))
            .await
            .unwrap();

        assert_eq!(exchange.response.status, 302);
        assert!(exchange.response.headers.contains(&(
            "location".to_owned(),
            "http://other.invalid/next".to_owned()
        )));
    }

    #[tokio::test]
    async fn req_http_003_tls_failure_unless_insecure_is_set() {
        use tokio_rustls::TlsAcceptor;
        use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
        use tokio_rustls::rustls::{ServerConfig, crypto::ring};

        let cert = rcgen::generate_simple_self_signed(vec!["localhost".to_owned()]).unwrap();
        let cert_der = CertificateDer::from(cert.cert.der().to_vec());
        let key_der =
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(cert.signing_key.serialize_der()));
        let config = ServerConfig::builder_with_provider(Arc::new(ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![cert_der], key_der)
            .unwrap();
        let acceptor = TlsAcceptor::from(Arc::new(config));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("https://{}/", listener.local_addr().unwrap());
        tokio::spawn(async move {
            loop {
                let Ok((socket, _)) = listener.accept().await else {
                    return;
                };
                let acceptor = acceptor.clone();
                tokio::spawn(async move {
                    let Ok(mut tls) = acceptor.accept(socket).await else {
                        return;
                    };
                    let mut buf = [0u8; 2048];
                    let _ = tls.read(&mut buf).await;
                    let _ = tls
                        .write_all(
                            b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok",
                        )
                        .await;
                    let _ = tls.shutdown().await;
                });
            }
        });

        let failure = send(spec("GET", &url))
            .await
            .expect_err("self-signed cert is rejected");
        assert_eq!(failure.kind, HttpFailureKind::Tls, "{}", failure.message);
        assert_eq!(failure.request.url, url);

        let mut insecure = spec("GET", &url);
        insecure.tls_insecure = true;
        let exchange = send(insecure)
            .await
            .expect("insecure mode accepts the cert");
        assert_eq!(exchange.response.status, 200);
        assert_eq!(exchange.response.body, "ok");
    }

    #[tokio::test]
    async fn req_http_004_slow_server_gives_timeout_failure() {
        let server = MockServer::start().await;
        Mock::given(any())
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_millis(1500)))
            .mount(&server)
            .await;
        let mut request = spec("GET", &server.uri());
        request.timeout_ms = 200;

        let failure = send(request).await.expect_err("times out");

        assert_eq!(failure.kind, HttpFailureKind::Timeout);
        assert_eq!(failure.request.method, "GET");
    }

    #[tokio::test]
    async fn req_http_005_invalid_requests_are_invalid_request_failures() {
        for request in [
            spec("GET", "not a url"),
            spec("GET", "ftp://example.com/file"),
            spec("BAD METHOD", "http://127.0.0.1:9/"),
            {
                let mut r = spec("GET", "http://127.0.0.1:9/");
                r.headers = pairs(&[("bad header name", "x")]);
                r
            },
            {
                let mut r = spec("GET", "http://127.0.0.1:9/");
                r.headers = pairs(&[("X-Ok", "line\nbreak")]);
                r
            },
        ] {
            let failure = send(request.clone()).await.expect_err("rejected");
            assert_eq!(failure.kind, HttpFailureKind::InvalidRequest, "{request:?}");
            assert_eq!(failure.request.url, request.url, "request is populated");
            assert!(!failure.message.is_empty());
        }
    }

    #[tokio::test]
    async fn req_http_005_refused_connection_is_connect_and_unknown_host_is_dns() {
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            listener.local_addr().unwrap().port()
        };
        let refused = send(spec("GET", &format!("http://127.0.0.1:{port}/")))
            .await
            .expect_err("connection refused");
        assert_eq!(
            refused.kind,
            HttpFailureKind::Connect,
            "{}",
            refused.message
        );

        let unknown = send(spec("GET", "http://no-such-host.invalid/"))
            .await
            .expect_err("dns failure");
        assert_eq!(unknown.kind, HttpFailureKind::Dns, "{}", unknown.message);
    }

    #[test]
    fn req_http_005_classification_precedence() {
        let none = ErrorFacts {
            is_timeout: false,
            is_builder: false,
            is_connect: false,
        };
        let connect = ErrorFacts {
            is_connect: true,
            ..none
        };
        let k = |facts, text: &str, mode| classify(facts, text, mode);
        assert_eq!(
            k(
                ErrorFacts {
                    is_timeout: true,
                    ..connect
                },
                "tls handshake",
                ProxyMode::None
            ),
            HttpFailureKind::Timeout
        );
        assert_eq!(
            k(
                ErrorFacts {
                    is_builder: true,
                    ..none
                },
                "builder error",
                ProxyMode::None
            ),
            HttpFailureKind::InvalidRequest
        );
        assert_eq!(
            k(
                connect,
                "client error (connect): invalid peer certificate: unknownissuer",
                ProxyMode::None
            ),
            HttpFailureKind::Tls
        );
        assert_eq!(
            k(
                connect,
                "client error (connect): dns error: failed to lookup address information",
                ProxyMode::None
            ),
            HttpFailureKind::Dns
        );
        assert_eq!(
            k(
                connect,
                "client error (connect): dns error: host sconosciuto. (os error 11001)",
                ProxyMode::None
            ),
            HttpFailureKind::Dns
        );
        assert_eq!(
            k(
                connect,
                "tcp connect error: connection refused",
                ProxyMode::None
            ),
            HttpFailureKind::Connect
        );
        assert_eq!(
            k(connect, "tcp connect error: refused", ProxyMode::Url),
            HttpFailureKind::Proxy
        );
        assert_eq!(
            k(none, "proxy authentication required", ProxyMode::System),
            HttpFailureKind::Proxy
        );
        assert_eq!(
            k(none, "unexpected eof", ProxyMode::None),
            HttpFailureKind::Other
        );
    }

    #[tokio::test]
    async fn req_http_006_mode_url_routes_through_the_proxy() {
        let proxy = MockServer::start().await;
        Mock::given(any())
            .respond_with(ResponseTemplate::new(200).set_body_string("via-proxy"))
            .mount(&proxy)
            .await;
        let mut request = spec("GET", "http://origin.invalid/some/path?x=1");
        request.proxy = ProxySpec {
            mode: ProxyMode::Url,
            url: Some(proxy.uri()),
        };

        let exchange = send(request).await.expect("proxy answers");

        assert_eq!(exchange.response.body, "via-proxy");
        let seen = proxy.received_requests().await.unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].url.host_str(), Some("origin.invalid"));
        assert_eq!(seen[0].url.path(), "/some/path");
    }

    #[tokio::test]
    async fn req_http_006_invalid_proxy_url_is_a_proxy_failure_not_a_panic() {
        for url in [Some("not a url".to_owned()), None, Some("  ".to_owned())] {
            let mut request = spec("GET", "http://127.0.0.1:9/");
            request.proxy = ProxySpec {
                mode: ProxyMode::Url,
                url,
            };
            let failure = send(request).await.expect_err("rejected");
            assert_eq!(failure.kind, HttpFailureKind::Proxy, "{}", failure.message);
        }
    }

    /// `system` honours the environment proxy; `none` ignores it. This is the only test that
    /// touches process environment, and every other test uses mode `none`, which never reads it.
    #[tokio::test]
    async fn req_http_006_system_uses_env_proxy_and_none_ignores_it() {
        let proxy = MockServer::start().await;
        Mock::given(any())
            .respond_with(ResponseTemplate::new(200).set_body_string("via-env-proxy"))
            .mount(&proxy)
            .await;
        let origin = MockServer::start().await;
        Mock::given(any())
            .respond_with(ResponseTemplate::new(200).set_body_string("direct"))
            .mount(&origin)
            .await;
        // SAFETY: no other test reads these variables; reqwest reads them when the first
        // `system` client is built, which happens below, after they are set.
        unsafe {
            std::env::set_var("HTTP_PROXY", proxy.uri());
            std::env::set_var("http_proxy", proxy.uri());
            std::env::remove_var("NO_PROXY");
            std::env::remove_var("no_proxy");
        }
        let target = format!("http://origin.invalid:{}/x", origin.address().port());

        let mut direct = spec("GET", &format!("{}/x", origin.uri()));
        direct.proxy.mode = ProxyMode::None;
        assert_eq!(send(direct).await.unwrap().response.body, "direct");
        assert!(proxy.received_requests().await.unwrap().is_empty());

        let mut system = spec("GET", &target);
        system.proxy.mode = ProxyMode::System;
        assert_eq!(send(system).await.unwrap().response.body, "via-env-proxy");
        assert_eq!(proxy.received_requests().await.unwrap().len(), 1);
    }
}
