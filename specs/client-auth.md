# Client authentication

`applyClientAuth(req, client, secret, tokenEndpoint)` in `src/lib/oauth/clientAuth.ts`.

### REQ-CAUTH-001 none

Status: Accepted

Given `client.auth` is `none`
When client auth is applied
Then the body contains `client_id` and no `Authorization` header or secret is added

### REQ-CAUTH-002 client_secret_basic

Status: Accepted

Given `client.auth` is `client_secret_basic`
When client auth is applied
Then the header is `Authorization: Basic base64(urlencode(id)+':'+urlencode(secret))` using application/x-www-form-urlencoded encoding (RFC 6749 §2.3.1)
And for id `a b` and secret `p:w/d` the encoded pair is `a+b:p%3Aw%2Fd` before base64

### REQ-CAUTH-003 client_secret_post

Status: Accepted

Given `client.auth` is `client_secret_post`
When client auth is applied
Then the body contains `client_id` and `client_secret` and no `Authorization` header

### REQ-CAUTH-004 client_secret_jwt

Status: Accepted

Given `client.auth` is `client_secret_jwt` with `jwtAlg` HS256, HS384 or HS512
When client auth is applied
Then the body contains `client_id`, `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer` and `client_assertion`
And the assertion is signed with the secret using `jwtAlg` with claims `iss`=`sub`=client_id, `aud`=tokenEndpoint, `jti` a uuid, `iat`=now, `exp`=now+60

### REQ-CAUTH-005 Missing secret validation

Status: Accepted

Given `client.auth` is `client_secret_basic`, `client_secret_post` or `client_secret_jwt` and no secret is stored
When a token request is prepared
Then the run fails before sending with `RunError { source: 'validation', error: 'missing_client_secret' }`
And no HTTP request is made
