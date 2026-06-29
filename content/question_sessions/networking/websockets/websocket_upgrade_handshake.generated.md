# WebSocket Upgrade Handshake


## Question

What happens during the WebSocket upgrade handshake?

## 2026-06-05

### Clue

The key idea: WebSocket starts life as an HTTP request, then both sides agree to stop speaking HTTP and switch protocols on the same TCP connection.

The client says: "I want to upgrade this HTTP connection to WebSocket."

The server says: "Accepted. From now on, this connection uses WebSocket frames."

### Why It Works

The opening handshake is useful because it lets WebSockets pass through much of the existing HTTP infrastructure: TLS, proxies, auth headers, cookies, origins, and load balancers.

The usual flow:

1. Client opens an HTTP/1.1 request with headers like `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Key`, and `Sec-WebSocket-Version`.
2. Server validates that it supports the upgrade and that the request is allowed.
3. Server returns `101 Switching Protocols` with `Upgrade: websocket`, `Connection: Upgrade`, and `Sec-WebSocket-Accept`.
4. After that response, the same underlying connection is no longer normal HTTP request/response. It carries WebSocket frames.

### Follow-Up Angles

- `Sec-WebSocket-Key` and `Sec-WebSocket-Accept` prove the server understood the WebSocket handshake; they are not authentication.
- Authentication may happen through cookies, headers, query tokens, or an application-level auth message after connection.
- With `wss://`, TLS happens before the HTTP upgrade, just like HTTPS.
- The handshake is only the door-opening step; production design still needs heartbeats, reconnection, authorization, message validation, backpressure, and observability.

### Load Balancer Follow-Up

The precise mental model:

- The client connects to `domain.com`.
- DNS resolves `domain.com` to an edge, proxy, or load balancer address.
- The client's TCP connection is to that edge/proxy/load balancer, not necessarily directly to the application server.
- The load balancer picks a backend server for the upgrade request.
- If the backend accepts, the load balancer keeps forwarding bytes between the client-side connection and the backend-side connection.

So from the client's perspective, the remote peer is stable: it is connected to `domain.com`'s resolved endpoint. Internally, the WebSocket is pinned to whichever backend the load balancer selected for that connection. Ordinary HTTP requests can be independently routed one by one, but a WebSocket connection is long-lived and cannot be moved to another backend mid-connection without closing and reconnecting.

The backend may not share the same TCP connection object as the client. In common reverse-proxy setups, there are two TCP connections:

1. Client to load balancer.
2. Load balancer to backend server.

In lower-level pass-through setups, the load balancer may preserve the TCP stream more transparently, but the important interview answer is the same: once established, that WebSocket session has connection affinity to a specific backend path until it disconnects.

Important implication: sticky sessions are not about keeping every future reconnect on the same server by default. They are about routing a given connection or repeat client consistently when the app needs local state. A more robust WebSocket architecture avoids relying only on local backend memory and uses shared pub/sub, presence storage, or a connection registry so reconnects and fanout can work even if the next connection lands elsewhere.
