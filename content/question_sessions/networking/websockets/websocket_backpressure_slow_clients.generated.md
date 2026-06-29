# WebSocket Backpressure for Slow Clients


## Question

How would you implement backpressure for a fast producer and slow WebSocket client?

## 2026-06-05

### Clue

The key idea: a WebSocket `send` is not proof that the client has consumed the message.

The server can produce messages faster than the network or client can receive them. If the server keeps buffering forever, one slow client can become a memory leak. Backpressure is the policy for what happens when a connection cannot keep up.

### Why It Works

For each connection, treat outbound delivery like a bounded queue:

```text
producer -> per-client send queue -> socket/network -> client
```

The server should track queue size or buffered bytes. When the queue grows beyond a threshold, it must choose a policy instead of buffering unboundedly.

Common policies:

- Slow down or stop reading from upstream if the protocol supports it.
- Drop non-critical messages, especially replaceable updates like presence, cursor position, typing indicators, or market tick snapshots.
- Coalesce messages, for example keep only the latest dashboard value per metric.
- Degrade quality, for example send fewer updates per second.
- Close the connection if the client remains too far behind.
- Persist important messages elsewhere and let the client resume by sequence number after reconnect.

### Specific Design

Each WebSocket gateway keeps per-connection state:

```text
connection_id: conn-789
user_id: D
send_queue: bounded queue
buffered_bytes: 1.8 MB
last_acknowledged_sequence: 1842
last_write_success_at: ...
slow_since: ...
```

On every outbound message:

1. Classify the message: critical, durable, replaceable, or best-effort.
2. Check the connection's current buffered bytes or queue depth.
3. If under threshold, enqueue/send normally.
4. If over threshold, apply policy:
   - drop or coalesce replaceable messages,
   - persist critical messages and send a resume hint,
   - unsubscribe the connection from high-volume streams,
   - close the socket if it remains unhealthy.

### Interview Sentence

> I would never let a WebSocket connection have an unbounded outbound buffer. I would track per-connection buffered bytes or queue depth, classify messages by importance, and apply explicit policies: coalesce replaceable updates, drop best-effort messages, persist critical events for replay, slow upstream producers where possible, and disconnect clients that stay behind too long.

### Follow-Up Angles

- Backpressure is different for one-to-one notifications, chat messages, market data, logs, and collaborative cursors.
- Critical messages need durable storage or acknowledgement/resume logic; WebSocket alone does not guarantee delivery.
- Slow clients should be visible in observability: queue depth, buffered bytes, dropped messages, disconnects due to backpressure, and end-to-end delivery lag.
- Fanout systems need backpressure at multiple levels: broker consumer lag, gateway queues, per-room fanout, and per-socket buffers.
