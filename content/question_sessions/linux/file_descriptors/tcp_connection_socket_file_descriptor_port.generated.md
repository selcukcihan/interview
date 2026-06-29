# TCP Connection, Socket, File Descriptor, and Port


## Question

What is the difference between a TCP connection, a socket, a file descriptor, and a port?

## 2026-06-05

### Clue

The key is to separate the layers:

- A port is an address component.
- A socket is an OS networking object.
- A file descriptor is the process's integer handle to an OS object.
- A TCP connection is the network relationship between two endpoints.

The "aha" is that these are not interchangeable words. They are related, but each answers a different question.

### Why It Works

A TCP connection is identified by a 4-tuple:

```text
client_ip, client_port, server_ip, server_port
```

Example:

```text
203.0.113.10:51544 -> 10.0.1.7:443
```

The server port `443` is not the whole connection. Many clients can connect to the same server IP and port because each connection has a different client IP/client port combination.

On the server process:

```text
fd 3 = listening socket on 0.0.0.0:443
fd 8 = accepted socket for client A
fd 9 = accepted socket for client B
fd 10 = accepted socket for client C
```

The listening socket waits for new connections. Each accepted connection gets its own socket object and usually its own file descriptor in the process.

### Concrete Definitions

#### Port

A port is a number used by TCP/UDP to identify which service on a host should receive traffic.

Examples:

- `443` for HTTPS.
- `5432` for PostgreSQL.
- `6379` for Redis.

A port is not a connection. It is part of an endpoint address.

#### TCP Connection

A TCP connection is the stateful byte-stream relationship between two endpoints.

It has TCP state such as sequence numbers, acknowledgements, congestion control, retransmissions, and close state.

#### Socket

A socket is the OS abstraction for network communication.

There are listening sockets and connected sockets:

- Listening socket: waits for incoming connections on an IP/port.
- Connected socket: represents one established client/server connection.

#### File Descriptor

A file descriptor is a small integer in a Unix process that refers to an open kernel object.

That object might be:

- a file,
- a socket,
- a pipe,
- a terminal,
- an eventfd,
- another OS resource.

So a socket can be accessed through a file descriptor, but a file descriptor is not always a socket.

### Interview Sentence

> A port is part of the network address, a TCP connection is the established relationship between two IP/port endpoints, a socket is the OS object representing network communication, and a file descriptor is the process-local integer handle used to refer to that socket or another open resource.

### Follow-Up Angles

- One listening port can serve many simultaneous TCP connections.
- Each accepted connection usually consumes a file descriptor.
- File descriptor limits can cap the number of sockets a process can hold.
- The same port can be reused by many connections because TCP identifies connections by the full 4-tuple, not by server port alone.
- In a reverse proxy, there may be one client-side connection/socket and one backend-side connection/socket.

### Follow-Up: Is One Listening Socket a Bottleneck?

The listening socket can become a bottleneck, but not because all traffic flows through one application-level object forever.

The important distinction:

```text
listening socket = accepts new connections
accepted socket = carries one established connection's traffic
```

After `accept()`, the client connection has its own connected socket/file descriptor. The listening socket goes back to waiting for more connections.

So the listening socket is more like a front door than a cashier. It is involved when connections arrive, but it does not personally process every byte for every connected client.

#### What the Kernel Does

For a TCP server:

1. Process creates a listening socket on `0.0.0.0:443`.
2. Kernel receives incoming SYN packets.
3. Kernel performs TCP handshake.
4. Completed connections wait in an accept queue.
5. Application calls `accept()`.
6. Kernel returns a new connected socket/file descriptor.
7. Worker handles reads/writes on that connected socket.

The accept queue is one scaling boundary. If connections arrive faster than the app accepts them, the queue fills and clients may see connection delays, timeouts, or resets depending on OS behavior.

#### How Servers Scale Accepting

Common models:

- One acceptor thread/process accepts connections and hands them to worker threads.
- Multiple worker processes share the same listening socket and all call `accept()`.
- Multiple sockets bind the same IP/port with `SO_REUSEPORT`, letting the kernel distribute new connections across workers.
- A load balancer spreads connections across multiple machines, each with its own listening socket.

Example:

```text
domain.com:443
  -> load balancer
    -> machine A:443
    -> machine B:443
    -> machine C:443
```

On each machine:

```text
worker 1 accepts some connections
worker 2 accepts some connections
worker 3 accepts some connections
```

#### Where the Bottlenecks Actually Are

The listening socket is rarely the only bottleneck. Scaling limits usually come from:

- accept queue/backlog size,
- CPU cost of TLS handshakes,
- file descriptor limits,
- memory per connection,
- kernel socket buffers,
- event loop or worker saturation,
- network bandwidth,
- downstream dependencies,
- load balancer capacity.

#### Interview Sentence

> A single port can serve many connections because the listening socket only accepts new connections. Each accepted connection gets a separate connected socket and file descriptor. Scaling comes from the kernel's accept queue, multiple acceptor workers or `SO_REUSEPORT`, event-driven I/O for many connected sockets, and horizontal scaling across machines behind a load balancer.

### Follow-Up: How Can Multiple Workers Listen on One Port?

There are two different models.

#### Model 1: One Bound Listening Socket Shared by Workers

One process creates the listening socket:

```text
socket()
bind(0.0.0.0:443)
listen()
```

Then that listening socket is shared with multiple workers.

With threads, this is natural because threads in a process share the same file descriptor table:

```text
process
  fd 3 = listening socket on :443
  thread 1 calls accept(fd 3)
  thread 2 calls accept(fd 3)
  thread 3 calls accept(fd 3)
```

With processes, a common pattern is:

```text
master process:
  socket()
  bind(:443)
  listen()
  fork worker 1
  fork worker 2
  fork worker 3
```

After `fork()`, the child processes inherit the listening socket file descriptor. They are not each independently binding to `:443`; they are sharing references to the same kernel listening socket.

```text
worker 1 fd 3 -> same listening socket
worker 2 fd 3 -> same listening socket
worker 3 fd 3 -> same listening socket
```

When several workers call `accept()` on that same socket, the kernel wakes one of them for a completed connection.

This is the classic prefork server model used by many servers historically, and variations exist in modern servers too.

#### Model 2: Multiple Independent Sockets with `SO_REUSEPORT`

Another model is for each worker to create its own socket and bind to the same IP/port, but only if the socket option allows it:

```text
worker 1:
  socket()
  setsockopt(SO_REUSEPORT)
  bind(:443)
  listen()

worker 2:
  socket()
  setsockopt(SO_REUSEPORT)
  bind(:443)
  listen()
```

Now there are multiple listening sockets for the same address. The kernel distributes incoming connections across them.

This can reduce contention on one shared accept queue and helps scale multi-core accept workloads.

#### Why You Usually Cannot Just Bind Twice

Without the right socket options, the second bind fails:

```text
Address already in use
```

The OS prevents arbitrary processes from both owning the same exact listening address because it would be ambiguous where incoming connections should go.

#### Systemd and Socket Activation

There is another variation: the service manager opens the socket first and passes the already-bound file descriptor to application processes.

```text
systemd binds :443
systemd starts service
service receives listening fd
workers accept from inherited fd
```

Again, the app workers are not independently winning the port. They are receiving or inheriting a file descriptor for a socket that was already bound.

#### Interview Sentence

> Multiple workers do not normally all bind to port 443 independently. Either they share one listening socket inherited from a master process or shared inside one multithreaded process, or they use `SO_REUSEPORT` so the kernel intentionally allows multiple listening sockets on the same address and distributes connections across them.

### Follow-Up: Why Do People Say HTTP Connection?

Strictly speaking, the connection is at the transport layer.

For HTTP/1.1 over TLS:

```text
HTTP messages
  over TLS session
    over TCP connection
      over IP
```

So when people say "HTTP connection", they usually mean "the underlying TCP/TLS connection being used to carry HTTP requests and responses."

HTTP itself defines request/response semantics: methods, paths, headers, status codes, bodies. TCP provides the reliable byte stream. TLS adds encryption and authentication. HTTP messages are serialized onto that stream.

#### Why the Phrase Still Exists

The phrase is useful because HTTP controls how the underlying transport is used.

Examples:

- HTTP/1.0 often opened a new TCP connection per request.
- HTTP/1.1 introduced persistent connections by default, so multiple requests can reuse the same TCP connection.
- HTTP/1.1 pipelining existed but was rarely used in browsers.
- HTTP/2 multiplexes many concurrent streams over one TCP connection.
- HTTP/3 runs over QUIC, not TCP, and QUIC has its own connection concept over UDP.

So "HTTP connection" is imprecise but common shorthand.

#### Better Wording

For precision:

- TCP connection: actual transport connection.
- TLS session/connection: encrypted layer over TCP.
- HTTP request/response: application-layer exchange.
- HTTP/2 stream: one logical request/response stream multiplexed over a connection.
- Keep-alive connection: reused underlying TCP connection for multiple HTTP requests.

#### Interview Sentence

> You're right that the real connection is at the transport layer. When people say HTTP connection, they usually mean the TCP or TLS connection carrying HTTP messages. HTTP defines how requests and responses use that transport, including whether the connection is closed after one request, reused with keep-alive, or multiplexed as in HTTP/2.
