# Load Balancers and Horizontal Scaling for WebSockets


## Question

How do load balancers and horizontal scaling affect WebSocket connections?

## 2026-06-05

### Clue

The key idea: HTTP load balancing is usually per request, but WebSocket load balancing is per connection.

Once a WebSocket is established, the load balancer cannot freely move that live connection between backend servers. It picks a backend during the upgrade, then that backend owns the socket until it closes.

### Why It Works

For normal HTTP:

```text
request 1 -> server A
request 2 -> server B
request 3 -> server C
```

Each request is short-lived, so the load balancer can make a fresh routing decision each time.

For WebSockets:

```text
client -> load balancer -> server B
```

The load balancer chooses `server B` during the HTTP upgrade. After `101 Switching Protocols`, that connection stays mapped to `server B` for its lifetime.

That means horizontal scaling has two separate problems:

1. Distributing new connections across WebSocket gateway nodes.
2. Delivering messages to users whose sockets may live on any node.

### Specific Effects

#### Connection Pinning

Each WebSocket connection is pinned to one backend path until disconnect. If the client reconnects, it may land on a different node.

#### Sticky Sessions

Sticky sessions can route the same user or client to the same backend across reconnects, but they are not a complete correctness strategy. Nodes still fail, deployments still happen, and clients may reconnect elsewhere.

#### Externalized State

The socket object itself lives in one backend process, but routing/session facts should live outside that process:

```text
user:123 -> node:ws-7, connection:abc
room:456 -> nodes:[ws-2, ws-7, ws-9]
```

This lets app services route events to the node that owns the socket.

#### Pub/Sub or Streaming Fanout

If user A is on `ws-1` and user B is on `ws-2`, `ws-1` cannot directly write to B's socket. It publishes an event to a broker or stream, and `ws-2` receives the event and writes to B's local socket.

#### Load Balancer Algorithms

Round-robin can be weak for WebSockets because connection lifetimes vary. Better signals often include:

- least active connections,
- weighted capacity,
- regional affinity,
- consistent hashing when locality matters.

#### Draining and Deploys

During deploys, a node should stop receiving new WebSockets before existing ones are closed:

1. Mark node as draining.
2. Load balancer stops assigning new connections to it.
3. Existing clients reconnect gradually or after a grace period.
4. Presence records expire or move to new nodes.

### Interview Sentence

> Load balancers affect WebSockets differently than HTTP because routing happens at connection setup, not on every message. Once the upgrade succeeds, the selected backend owns that socket until disconnect. So horizontal scaling requires both good connection distribution and an external routing/fanout layer, because users connected to different nodes still need to exchange messages.

### Follow-Up Angles

- The client usually connects to the load balancer or reverse proxy, not directly to the application server.
- Active connection count matters more than request count.
- Idle timeouts and heartbeats must be configured for long-lived sockets.
- Correctness should not depend solely on sticky sessions.
- Reconnect behavior is part of the architecture, not just client polish.
