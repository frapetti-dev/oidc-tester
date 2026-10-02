# HTTP transport

Rust command `http_send(req: HttpRequestSpec) -> Result<HttpExchange, HttpFailure>` is a thin transport; TS adds redirects and header merging.

### REQ-HTTP-001 Headers, body and order forwarded verbatim

Status: Accepted

Given an `HttpRequestSpec` with method, url, `headers` as an ordered list of pairs (duplicates allowed) and a `body`
When `http_send` is called
Then the server receives exactly those headers in that order and the exact body
And the returned `HttpExchange.request` echoes method, url, headers and body, and `response` has status, statusText, httpVersion, headers, body

### REQ-HTTP-002 Redirect handling split between Rust and TS

Status: Accepted

Given a server that answers `302` with a `Location` header
When `http_send` is called
Then the result has `response.status` 302 and the `Location` header, with no redirect followed (`redirect(Policy::none())`)
And when TS `sendWithRedirects` issues a GET, it follows 301/302/303/307/308 up to 5 hops, each hop logged as its own exchange
And a non-GET request is never redirected, and a 6th hop stops with an error

### REQ-HTTP-003 TLS validation can be skipped

Status: Accepted

Given an HTTPS server with a self-signed certificate
When `http_send` is called with `tlsInsecure=false`
Then it fails with `HttpFailure.kind` `tls`
And with `tlsInsecure=true` (`danger_accept_invalid_certs` and `danger_accept_invalid_hostnames`) it returns status 200

### REQ-HTTP-004 Timeout failure

Status: Accepted

Given a server that responds slower than `timeoutMs`
When `http_send` is called
Then it returns `HttpFailure` with `kind` `timeout`

### REQ-HTTP-005 Failure kinds mapping

Status: Accepted

Given reqwest errors
When they are mapped to `HttpFailure { kind, message, request }`
Then `is_builder` or an invalid URL gives `invalidRequest`, `is_timeout` gives `timeout`, a rustls error in the source chain gives `tls`, a DNS resolution error gives `dns`, `is_connect` gives `connect`, proxy errors give `proxy`, anything else gives `other`
And `request` is always populated

### REQ-HTTP-006 Proxy modes

Status: Accepted

Given `ProxySpec { mode, url }`
When `http_send` builds its client
Then mode `none` calls `no_proxy()`, mode `url` uses `Proxy::all(url)`, and mode `system` uses the reqwest default (environment/system proxy)
And an invalid proxy URL yields a failure rather than a panic

### REQ-HTTP-007 Header merge precedence

Status: Accepted

Given IdP `http.headers`, flow `headers` and protocol headers (Content-Type, Accept, Authorization)
When a back-channel request is built
Then IdP headers come first, a flow header with the same name (case-insensitive) replaces the IdP one, and protocol headers are added unless the user explicitly set that header name
And only enabled header rows are used

### REQ-HTTP-008 Origin header from settings

Status: Accepted

Given IdP `http.origin` is non-empty
When a back-channel request is built
Then it includes the header `Origin: <http.origin>`
And with an empty `origin` no `Origin` header is added
