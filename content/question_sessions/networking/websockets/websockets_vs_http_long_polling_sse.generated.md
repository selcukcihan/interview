# WebSockets vs HTTP, Long Polling, and SSE


## Question

How do WebSockets differ from HTTP request/response, long polling, and Server-Sent Events, and when would you choose each?

## 2026-06-05

### Clue

The key is direction and ownership of time:

- HTTP: client asks, server answers, then the interaction is over.
- Long polling: client asks, server delays the answer until something happens.
- SSE: client opens a one-way server-to-client stream.
- WebSocket: both sides own the connection and can speak whenever they need.

The "aha" is that WebSocket is not "faster HTTP." It is a different conversation shape: a long-lived, bidirectional channel.

### Why It Works

Most interview answers become clear if you classify the product requirement by communication pattern:

- Use HTTP when the client initiates discrete actions: fetch profile, submit form, create order.
- Use long polling when you need near-real-time updates but infrastructure is simple and update volume is modest.
- Use SSE when updates only flow from server to client: notifications, status feeds, logs, dashboards.
- Use WebSockets when both sides need low-latency communication: chat, multiplayer, collaborative editing, trading UI, presence, live control surfaces.

### Follow-Up Angles

- WebSockets create operational concerns that ordinary HTTP avoids: connection limits, sticky routing or connection ownership, heartbeats, backpressure, reconnect behavior, and fanout.
- SSE is often underrated because it is simpler than WebSockets when the client does not need to send frequent real-time messages.
- Long polling is a compatibility pattern, not the cleanest model when true streaming is available.
