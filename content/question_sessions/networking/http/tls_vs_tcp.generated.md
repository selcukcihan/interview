# TLS vs TCP


## Question

What is the difference between TLS and TCP?

## 2026-06-05

### Clue

TCP is about delivery. TLS is about trust and secrecy.

- TCP creates a reliable ordered byte stream between two endpoints.
- TLS runs on top of that stream and adds encryption, server identity verification, and integrity protection.

### Why It Works

For HTTPS:

```text
HTTP
  over TLS
    over TCP
      over IP
```

TCP answers:

- Can bytes get from host A to host B reliably?
- Are they delivered in order?
- Should lost packets be retransmitted?
- How fast should the sender transmit without overwhelming the network?

TLS answers:

- Am I talking to the real server for this domain?
- Can intermediaries read the data?
- Can intermediaries modify the data undetected?
- How do both sides agree on encryption keys?

### Concrete Difference

TCP does not know whether the bytes are secret or authentic. It only delivers bytes.

TLS does not route packets or retransmit lost data. It assumes there is already a reliable byte stream underneath, usually TCP, and secures the data flowing through it.

### Interview Sentence

> TCP is the transport protocol that gives applications a reliable ordered byte stream. TLS is a security protocol layered above TCP that encrypts that byte stream, verifies server identity through certificates, and protects message integrity. HTTPS is HTTP messages sent through TLS over TCP.

### Follow-Up Angles

- Plain HTTP is HTTP over TCP without TLS.
- HTTPS is HTTP over TLS over TCP.
- `wss://` is WebSocket over TLS over TCP.
- TLS termination can happen at a load balancer, reverse proxy, or application server.
- HTTP/3 is different because it uses QUIC over UDP; QUIC integrates transport and TLS-like security differently.
