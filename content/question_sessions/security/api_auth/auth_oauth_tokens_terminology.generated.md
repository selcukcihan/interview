# Auth, OAuth, Tokens, Sessions, and API Keys


## Question

What is the difference between authentication, authorization, OAuth, OpenID Connect, access tokens, ID tokens, refresh tokens, API keys, sessions, and JWTs?

## Short Answer

The main confusion comes from mixing four separate questions:

```text
Who are you?                 -> authentication
What are you allowed to do?  -> authorization
How do apps get delegated access? -> OAuth 2.0
How do apps learn user identity?  -> OpenID Connect
```

Then tokens and credentials are just implementation tools:

```text
session cookie   -> browser proves it has an active login session
access token     -> client calls an API/resource server
ID token         -> client learns authenticated user's identity
refresh token    -> client gets new access tokens
API key          -> identifies/authenticates an app, script, or project
JWT              -> token format, not a login protocol
```

## Core Terms

### Authentication

Authentication answers:

```text
Who is this?
```

Examples:

- user enters email and password;
- user signs in with Google;
- service presents a client certificate;
- script sends an API key.

Authentication creates confidence about an identity.

### Authorization

Authorization answers:

```text
What is this identity allowed to do?
```

Examples:

- user can read project `123`;
- user can invite members to workspace `abc`;
- service can write to bucket `reports-prod`;
- API token has `orders:read` but not `orders:write`.

Authentication usually happens before authorization, but they are different decisions.

### Principal / Subject

A **principal** is the entity being authenticated or authorized.

It could be:

- a human user;
- a service account;
- an application;
- a device;
- an organization member.

In token terminology, `sub` usually means **subject**: the identifier of the authenticated entity.

## Sessions

A traditional web login often works like this:

```text
1. User submits email/password.
2. Server verifies password.
3. Server creates session record in database/Redis.
4. Server sends browser a session cookie.
5. Browser sends cookie on later requests.
6. Server looks up session and knows the user.
```

The cookie may contain only a random session ID:

```text
session_id=abc123random
```

The server stores the meaning:

```text
abc123random -> user_id=42, expires_at=..., mfa=true
```

This is **stateful** because the server must remember the session.

## JWT

JWT means JSON Web Token.

A JWT is a token format with three base64url-encoded parts:

```text
header.payload.signature
```

Example payload:

```json
{
  "sub": "user_42",
  "iss": "https://auth.example.com",
  "aud": "api.example.com",
  "exp": 1893456000,
  "scope": "orders:read"
}
```

Important:

```text
JWT is a format, not a security architecture by itself.
```

A JWT can be used as:

- an access token;
- an ID token;
- a session token;
- something else.

Do not say "we use JWT instead of OAuth." That mixes a token format with an authorization protocol.

## OAuth 2.0

OAuth 2.0 is about **delegated authorization**.

It answers:

```text
How can one application get permission to access a resource on behalf of a user or itself, without receiving the user's password?
```

Classic example:

```text
User wants calendar-app.example to read Google Calendar.

The app should not ask for the user's Google password.
Instead, Google issues the app an access token with limited permission.
```

OAuth roles:

```text
resource owner:
  usually the user who owns the data

client:
  application requesting access

authorization server:
  server that authenticates user and issues tokens

resource server:
  API that accepts access tokens and serves protected data
```

Example:

```text
resource owner:       Alice
client:               calendar-app.example
authorization server: accounts.google.com
resource server:      Google Calendar API
```

OAuth does not primarily define "login". It defines how clients obtain access tokens.

## OpenID Connect

OpenID Connect, or OIDC, is an identity layer on top of OAuth 2.0.

OAuth gives delegated API access.

OIDC adds login/identity information.

OIDC introduces the **ID token**:

```text
ID token says: this user authenticated, here is their identity information
```

Typical OIDC result:

```text
access token -> call API
ID token     -> client learns who signed in
```

If a site says "Sign in with Google", it is usually using OpenID Connect, not plain OAuth alone.

## Access Token

An access token is presented to an API/resource server.

It answers:

```text
Can this caller access this resource/API?
```

Example:

```http
GET /orders/123 HTTP/1.1
Authorization: Bearer eyJ...
```

The API validates the access token and checks:

- issuer: who issued it?
- audience: is this token meant for this API?
- expiry: is it still valid?
- signature or introspection result: is it authentic?
- scopes/permissions: does it allow this operation?
- subject/client: who is calling?

Access tokens should usually be short-lived.

## ID Token

An ID token is for the client application, not for arbitrary APIs.

It answers:

```text
Who authenticated?
When?
Which identity provider issued this assertion?
```

An ID token may contain claims like:

```json
{
  "iss": "https://accounts.example.com",
  "sub": "user_42",
  "aud": "web_client_123",
  "email": "alice@example.com",
  "email_verified": true,
  "exp": 1893456000
}
```

Important rule:

```text
Use access tokens to call APIs.
Use ID tokens to authenticate the user to the client.
```

An API should not accept an ID token as if it were an access token. The `aud` of an ID token is usually the client application, not the API.

## Refresh Token

A refresh token is used to obtain new access tokens.

It answers:

```text
Can this client continue the session and get a fresh access token?
```

Typical flow:

```text
1. User logs in.
2. Client receives short-lived access token.
3. Client may receive longer-lived refresh token.
4. Access token expires.
5. Client sends refresh token to authorization server.
6. Authorization server returns new access token.
```

Refresh tokens are sensitive because they can mint new access tokens. They should be stored more carefully than access tokens.

Common protections:

- store in secure HTTP-only cookies for browser apps;
- rotate refresh tokens after use;
- detect reuse of old refresh tokens;
- bind to a client/device when possible;
- expire after inactivity or maximum lifetime;
- revoke on logout/password change/security events.

## API Key

An API key is usually a long random secret used by a script, service, project, or developer account.

Example:

```http
GET /v1/events HTTP/1.1
Authorization: Bearer sk_live_randomsecret
```

or:

```http
X-API-Key: randomsecret
```

API keys are simpler than OAuth:

```text
API key:
  "this caller has this secret"

OAuth access token:
  "this client was issued delegated, scoped, time-limited authorization"
```

API keys are common for:

- server-to-server APIs;
- developer platforms;
- internal tools;
- scripts;
- project-level credentials.

API key best practices:

- generate high-entropy random values;
- show full key only once;
- store only a hash of the key server-side when possible;
- support rotation;
- support revocation;
- scope keys to least privilege;
- track last used time and source;
- avoid putting keys in URLs because URLs are logged widely.

## Passwords

Passwords are user credentials.

A server should not store plaintext passwords.

Good storage pattern:

```text
password
  -> unique salt
  -> slow password hashing algorithm
  -> stored password hash
```

Use password hashing algorithms designed for passwords:

- Argon2id;
- bcrypt;
- scrypt;
- PBKDF2 in some environments.

Do not use fast general hashes like SHA-256 directly for passwords.

## Browser Token Storage

Common options:

```text
HttpOnly Secure SameSite cookie:
  not readable by JavaScript
  automatically sent by browser
  CSRF must be considered

localStorage:
  readable by JavaScript
  vulnerable if XSS happens
  not automatically sent

memory:
  less persistent
  lost on refresh
  still vulnerable to active XSS
```

For browser apps, secure cookies are often preferred for session/refresh-token storage, but the right design depends on architecture and CSRF/XSS controls.

## Concrete Login Examples

### Traditional Session Login

```text
browser -> POST /login email/password
server verifies password hash
server creates session row
server sets HttpOnly Secure SameSite cookie
browser sends cookie on future requests
server checks session and authorization
```

Good when:

- first-party web app;
- same backend controls UI and API;
- easy revocation is useful.

### SPA Using OIDC Authorization Code With PKCE

```text
browser app redirects user to identity provider
user authenticates at identity provider
identity provider redirects back with authorization code
browser app exchanges code + PKCE verifier for tokens
app receives access token and maybe ID token/refresh token
app calls API with access token
```

Good when:

- login handled by external identity provider;
- single-page app needs delegated API access;
- password should not be handled by the app.

### Machine-To-Machine OAuth

```text
service authenticates to authorization server with client credentials
authorization server returns access token
service calls API with access token
```

Good when:

- no human user is involved;
- service-to-service access needs scopes, expiry, and centralized control.

### API Key Access

```text
developer creates API key in dashboard
server stores key hash and metadata
developer sends key with API requests
API authenticates key and enforces scopes/rate limits
```

Good when:

- developer/platform API;
- simple server-side integration;
- user delegation is not needed.

## Common Terminology Mistakes

### Mistake: OAuth Means Login

More precise:

```text
OAuth 2.0 is delegated authorization.
OpenID Connect adds authentication/login identity on top.
```

### Mistake: JWT Means Stateless Auth

More precise:

```text
JWT is a token format.
You can still have revocation lists, sessions, introspection, rotation, and server-side state.
```

### Mistake: ID Token Can Call APIs

More precise:

```text
ID token is meant for the client.
Access token is meant for the resource server/API.
```

### Mistake: Refresh Token Is Just A Longer Access Token

More precise:

```text
access token calls APIs.
refresh token gets new access tokens from the authorization server.
```

### Mistake: API Key Identifies A User The Same Way Login Does

More precise:

```text
API key usually identifies an application, project, service account, or developer credential.
It may be associated with a user account, but it is not the same as an interactive user login.
```

## Interview Sentence

> Authentication proves who the caller is, while authorization decides what they can do. OAuth 2.0 is a delegated authorization framework: a client gets an access token from an authorization server and uses it to call a resource server. OpenID Connect builds on OAuth and adds login identity through an ID token. Access tokens are for APIs, ID tokens are for clients to learn who authenticated, and refresh tokens are used to get new access tokens. JWT is only a token format; it can represent different token types. API keys are simpler long-lived secrets for apps or services, while passwords are user credentials that must be stored with slow salted password hashing.

## Follow-Up Angles

- What exactly happens in Authorization Code with PKCE?
- Why should APIs validate access tokens instead of ID tokens?
- How should refresh token rotation work?
- How do cookies compare with local storage for browser auth?
- How should passwords be hashed and reset flows be designed?
- How do API key rotation and revocation work?
- What is JWKS and how does JWT signature verification work?

## Follow-Up: For Sign In With Google, Do I Use OAuth Or OIDC?

Use **OpenID Connect**, usually abbreviated OIDC.

More precisely:

```text
Sign in with Google uses an OIDC login flow built on top of OAuth 2.0.
```

OAuth 2.0 by itself is mainly about delegated authorization:

```text
Allow this app to access my Google Calendar.
Allow this app to read my GitHub repositories.
Allow this app to post to my Slack workspace.
```

OIDC is about authentication and identity:

```text
Sign me in with my Google account.
Tell this application who authenticated.
Give this application a stable subject identifier for the user.
```

When building a new app with "Sign in with Google", the app usually wants identity information:

```text
Google authenticated this user.
Their stable Google subject ID is ...
Their email is ...
Their email is verified ...
Their name/profile picture may be ...
```

That identity information comes from OIDC, especially:

- the **ID token**;
- sometimes the OIDC `userinfo` endpoint.

The mechanics still look like OAuth:

```text
1. User clicks "Sign in with Google".
2. App redirects the user to Google's authorization server.
3. User authenticates at Google.
4. Google redirects back to the app with an authorization code.
5. App exchanges the code for tokens.
6. App receives an ID token and often an access token.
7. App validates the ID token.
8. App creates or links a local user account.
9. App creates its own session for the user.
```

The most important token for login is:

```text
ID token = proof to your app that Google authenticated the user
```

A precise way to say it:

> We use OpenID Connect with Google as the identity provider, using the OAuth 2.0 Authorization Code flow.

In practice, provider dashboards and docs often say "OAuth" even when the login feature is OIDC, because OIDC is layered on OAuth 2.0. For sign-up/sign-in, the conceptually correct answer is OIDC.

## Sources

- [OAuth 2.0 Framework: RFC 6749](https://www.rfc-editor.org/rfc/rfc6749)
- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)
- [JSON Web Token: RFC 7519](https://www.rfc-editor.org/rfc/rfc7519)
- [OAuth 2.0 Security Best Current Practice: RFC 9700](https://www.rfc-editor.org/rfc/rfc9700)
