# Scale a WebSocket Service to Millions of Connections


## Question

How would you scale a WebSocket service to millions of concurrent connections?

## 2026-06-05

### Clue

The key is to separate connection scale from message scale.

Scaling WebSockets is not only "add more servers." Each server owns many long-lived connections, but messages may need to reach users connected to other servers. So the design needs:

- many lightweight connection nodes,
- routing/fanout through shared infrastructure,
- minimal per-connection memory,
- backpressure and disconnect policy,
- reconnection and presence handling.

### Why It Works

A million WebSockets means a million open file descriptors, TLS sessions, buffers, heartbeats, and possible slow clients. The system bottleneck may be memory, kernel limits, load balancer capacity, publish fanout, hot rooms/channels, or downstream dependencies.

A good design usually has these layers:

1. Edge/load balancer supports long-lived connections and distributes new connections across WebSocket gateway nodes.
2. WebSocket gateway nodes terminate connections, authenticate users, track subscriptions, send heartbeats, and enforce backpressure.
3. Shared pub/sub or streaming layer routes events to the nodes that currently hold interested connections.
4. Presence/session registry records which user/channel is connected to which node, usually with TTLs.
5. Application services publish events without needing to know the exact socket process.
6. Clients use reconnect with jitter, resume tokens, and missed-message recovery where needed.

### Follow-Up Angles

- Do not store important state only in the WebSocket process if reconnecting to a different node would lose correctness.
- Sticky sessions can reduce routing complexity but should not be the only correctness mechanism.
- Backpressure is mandatory: slow clients cannot be allowed to grow unbounded buffers.
- Hot channels need special care because fanout can dominate connection count.
- "Millions of connections" is mostly an operations question: file descriptor limits, memory per socket, heartbeat intervals, TLS/load balancer capacity, autoscaling, deploy draining, and observability.

### Concrete Pub/Sub and Presence Model

Assume three WebSocket gateway nodes:

```text
ws-1 owns sockets for users A, B
ws-2 owns sockets for users C, D
ws-3 owns sockets for users E, F
```

If an application service wants to notify user D, it should not need to know that D is currently connected to `ws-2`. That knowledge changes constantly as clients reconnect, servers deploy, and nodes fail.

So the system keeps an external presence/session registry, commonly in Redis, DynamoDB, etcd, or another low-latency store:

```text
presence:user:D -> {
  node_id: "ws-2",
  connection_id: "conn-789",
  connected_at: "...",
  last_seen_at: "...",
  expires_at: "..."
}
```

For channels or rooms:

```text
channel:room:123:members -> [user:A, user:D, user:F]
channel:room:123:nodes -> [ws-1, ws-2, ws-3]
```

The exact schema varies, but the key idea is the same: connection ownership is recorded outside the process that owns the socket.

#### Direct User Notification

Example: send "payment completed" to user D.

1. User D connects to `ws-2`.
2. `ws-2` authenticates D.
3. `ws-2` writes `presence:user:D -> ws-2 / conn-789` with a TTL.
4. A payment service emits `PaymentCompleted(user_id=D, payload=...)`.
5. A notification/router service looks up `presence:user:D`.
6. It sees D is on `ws-2`.
7. It publishes the message to a pub/sub topic consumed by `ws-2`, for example `node.ws-2`.
8. `ws-2` receives the internal event and writes the payload to D's actual WebSocket connection.

The application service never writes directly to the socket. It publishes an event and the WebSocket layer handles delivery to the node that owns the connection.

#### Room or Channel Fanout

Example: send a chat message to room `123`.

1. User A sends a WebSocket message to `ws-1`: `SendMessage(room_id=123, text=...)`.
2. `ws-1` validates auth and publishes `RoomMessage(room_id=123, ...)` to a stream or pub/sub topic like `room.123`.
3. Gateway nodes with users subscribed to room `123` receive the event.
4. Each node delivers the message only to its local sockets in that room.

If the room is small, all relevant nodes can subscribe directly to `room.123`. If the room is huge, the system may need partitioned fanout, batching, regional fanout, or a dedicated fanout service.

#### Why Not Keep This Only in Memory?

If `ws-2` only keeps "D is connected here" in local memory, then other services cannot reliably find D.

Local-only state breaks down when:

- the client reconnects and lands on `ws-3`,
- `ws-2` is draining for deploy,
- `ws-2` crashes,
- another service needs to send D a notification,
- multiple devices are connected for the same user,
- a room spans users connected to many different nodes.

External presence does not mean every byte of socket state is persisted. The actual TCP/WebSocket object still lives inside one process. The external store holds enough routing/session metadata to recover and route correctly.

#### Reconnects

On reconnect:

1. Client connects again, maybe to `ws-3`.
2. `ws-3` authenticates the client.
3. `ws-3` overwrites or adds a new presence entry for that user/device.
4. Client sends a resume token, last message id, or last sequence number.
5. Server replays missed messages from durable storage if the product requires it.

This is why pub/sub alone is not enough for guaranteed delivery. Pub/sub is often ephemeral. If the client is offline, the message may be gone unless important messages are also written to durable storage.

#### Deploys and Node Failure

For deploys:

1. Mark node as draining.
2. Stop accepting new WebSockets.
3. Let existing sockets finish or ask clients to reconnect.
4. Remove or expire presence records for that node.

For crashes:

1. Heartbeats stop.
2. Presence TTLs expire.
3. Clients reconnect to another node.
4. New node recreates subscriptions and presence.

The interview sentence:

> The socket object is local to one gateway process, but the routing facts are externalized: user X is connected through node Y, connection Z, subscribed to channels A and B. Application services publish events to a broker, and the broker or routing layer gets those events to the gateway nodes that currently own the relevant sockets.

### Load Balancer Perspective

From the load balancer's point of view, a WebSocket starts like an HTTP request but becomes a long-lived connection mapping.

Initial path:

```text
client -> load_balancer -> ws_gateway
```

Lifecycle:

1. Client opens a TCP/TLS connection to the load balancer.
2. Client sends HTTP request with `Upgrade: websocket`.
3. Load balancer chooses a backend WebSocket gateway, for example `ws-2`.
4. Load balancer forwards the upgrade request to `ws-2`.
5. `ws-2` returns `101 Switching Protocols`.
6. Load balancer keeps a mapping like:

```text
client_conn_abc <-> backend_conn_xyz on ws-2
```

7. After that, the load balancer mostly forwards bytes in both directions until one side closes, a timeout fires, or the backend is removed.

The load balancer is not usually looking at every application message and deciding where to send it. It made the backend choice when the connection was established. After upgrade, this is closer to connection proxying than per-request routing.

#### Why Round-Robin Can Be Bad

With normal HTTP, round-robin can be acceptable because each request is short-lived. With WebSockets, a connection may last minutes or hours.

If `ws-1` receives many long-lived users and `ws-2` receives users who disconnect quickly, round-robin can create imbalance.

Better balancing signals include:

- least active connections,
- least outstanding connection load,
- backend capacity weighting,
- consistent hashing by user/tenant when locality matters,
- regional routing to keep users near the closest gateway.

#### Health Checks and Draining

Health checks should determine whether a node can receive new connections. Existing WebSocket connections need draining behavior:

1. Mark `ws-2` unhealthy or draining for new connections.
2. Load balancer stops assigning new WebSockets to `ws-2`.
3. Existing WebSockets on `ws-2` remain open for a grace period.
4. Server may send clients a reconnect instruction or close with an appropriate close code.
5. Clients reconnect and land on other healthy nodes.

Without draining, deploys can create reconnect storms or unnecessary message loss.

#### Timeouts

The load balancer needs WebSocket-friendly idle timeouts. If the idle timeout is 60 seconds and the application sends no data, the load balancer may close a perfectly valid socket.

That is why gateways usually send ping/pong heartbeats or application keepalives at an interval shorter than the most aggressive idle timeout in the path.

#### TLS Termination

Two common models:

```text
client --wss/TLS--> load_balancer --plain/ws--> backend
client --wss/TLS--> load_balancer --wss/TLS--> backend
```

If TLS terminates at the load balancer, the backend sees proxied traffic and may rely on forwarded headers for original scheme, IP, and host. If TLS passes through, the backend terminates TLS itself, but the load balancer has less HTTP-layer visibility.

The interview sentence:

> The load balancer selects a WebSocket backend once, during connection setup, then maintains a long-lived client-to-backend mapping and forwards frames until the connection closes. So for WebSockets I care about active connection distribution, idle timeouts, backend draining, health checks, and reconnect behavior, not just per-request routing.
