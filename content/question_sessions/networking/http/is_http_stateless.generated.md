# Is HTTP Stateless?


## Question

Is HTTP stateless?

## 2026-06-05

### Clue

HTTP is stateless because each request is supposed to carry enough information for the server to understand it without relying on memory of a previous request.

But web applications are often stateful. They build state on top of HTTP using cookies, sessions, tokens, caches, databases, and client-side storage.

### Why It Works

The protocol itself does not require the server to remember that request 2 belongs to the same conversation as request 1.

Example:

```text
GET /cart
Cookie: session_id=abc123
```

HTTP is not remembering the user. The cookie is sent with the request, and the application uses that cookie to look up state.

So the precise distinction is:

```text
HTTP protocol = stateless
application built on HTTP = often stateful
```

### Common Sources of State

- Cookies carrying session IDs.
- Server-side session stores like Redis or a database.
- JWTs carrying signed claims.
- Database rows for carts, orders, preferences, and account state.
- Client-side storage.
- Load balancer sticky sessions.
- Caches and CDN state.

### Important Nuance

Persistent TCP connections do not make HTTP stateful.

HTTP/1.1 keep-alive reuses the same TCP connection for multiple requests, and HTTP/2 multiplexes many streams over one connection. That is transport reuse, not application state.

The server can still process each HTTP request independently if the request includes credentials, headers, path, method, and body needed to make the decision.

### Interview Sentence

> HTTP is stateless in the sense that the protocol treats each request as self-contained; it does not require the server to remember previous requests. But most web applications create state above HTTP using cookies, sessions, tokens, databases, and caches. Reusing a TCP connection with keep-alive is connection state, not application session state.

### Follow-Up Angles

- REST builds on this idea by encouraging self-contained requests.
- Cookies do not make HTTP itself stateful; they are a mechanism for carrying state identifiers.
- Sticky sessions can create operational coupling because requests for one user may need the same backend.
- Stateless application servers are easier to horizontally scale because state lives in shared stores or signed client tokens.
