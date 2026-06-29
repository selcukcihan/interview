# HTTP Versions, Adoption, Selection, and Negotiation


## Question

What are the main versions of HTTP, how frequently are they used, how do we decide which one to use, what are their limitations, and how do client and server decide what to use together?

## 2026-06-05

### Clue

The key is that HTTP semantics stayed mostly familiar, but the wire format and transport changed.

```text
HTTP/1.1 = text requests over TCP, simple but limited concurrency
HTTP/2   = binary multiplexed streams over one TCP connection
HTTP/3   = HTTP/2-like semantics over QUIC/UDP to avoid TCP-level head-of-line blocking
```

Most application code does not manually choose per request. Browsers and servers negotiate the best mutually supported version.

### Main Versions

#### HTTP/1.1

The long-standing baseline version.

Strengths:

- universally supported,
- simple text format,
- easy to debug,
- works through almost every proxy and network.

Limitations:

- one request/response at a time per connection in normal browser use,
- often needs multiple parallel TCP connections,
- inefficient headers compared with newer versions,
- vulnerable to application-level head-of-line blocking on a reused connection.

#### HTTP/2

Keeps HTTP semantics but changes the wire protocol to binary frames and streams.

Strengths:

- multiplexes many requests over one TCP connection,
- compresses headers with HPACK,
- usually improves browser performance for asset-heavy pages,
- used by gRPC in many deployments.

Limitations:

- still sits on one TCP connection, so packet loss can block all streams at the TCP layer,
- more complex than HTTP/1.1,
- HTTP/2 server push was difficult to use well and has been removed or disabled by major browsers,
- connection-level issues can affect many logical streams.

#### HTTP/3

Keeps HTTP semantics but runs over QUIC instead of TCP.

Strengths:

- avoids TCP-level head-of-line blocking between streams,
- combines transport security into QUIC/TLS 1.3,
- can improve connection setup and network migration,
- useful on lossy/mobile networks.

Limitations:

- requires UDP/QUIC reachability,
- more operational complexity,
- not all enterprise networks and middleboxes handle it cleanly,
- server/framework/proxy support can be less mature than HTTP/2,
- observability/debugging is different from TCP-based stacks.

### Adoption Signal

As of 2026, HTTP/2 is broadly deployed and commonly the default for HTTPS sites. HTTP/1.1 still matters as the universal fallback and for many upstream/backend connections. HTTP/3 is widely supported by major browsers and CDNs, but its actual traffic share depends heavily on geography, network, CDN, browser, and whether UDP/QUIC is allowed.

Public trackers differ because some measure websites that support a version, while others measure request traffic. Treat exact percentages as directional, not universal.

The practical interview answer:

```text
HTTP/1.1: still everywhere as fallback and simple upstream protocol
HTTP/2: mainstream default for modern HTTPS browser traffic
HTTP/3: increasingly common at the edge/CDN, especially where QUIC works well
```

### How to Decide Which One to Use

For public web traffic:

- Enable HTTP/2 by default for HTTPS.
- Enable HTTP/3 at the edge/CDN if the platform supports it well.
- Keep HTTP/1.1 fallback.

For internal services:

- HTTP/1.1 is fine for simple REST/JSON and easy debugging.
- HTTP/2 is useful for gRPC, multiplexing, long-lived connections, and many concurrent streams.
- HTTP/3 is less common internally unless there is a specific need and operational maturity.

For compatibility:

- keep HTTP/1.1 available,
- be careful with old proxies,
- test client libraries, load balancers, ingress, observability, and retries.

### How Client and Server Decide

For HTTPS with HTTP/1.1 vs HTTP/2:

1. Client opens TCP.
2. Client starts TLS handshake and advertises supported application protocols using ALPN, such as `h2` and `http/1.1`.
3. Server selects one protocol it supports.
4. Both sides speak that protocol on the TLS connection.

For HTTP/3:

1. Client first learns that the origin supports HTTP/3, often through `Alt-Svc` or HTTPS DNS records.
2. Client attempts QUIC over UDP.
3. During QUIC/TLS setup, ALPN selects `h3`.
4. If QUIC fails or is blocked, the client falls back to HTTP/2 or HTTP/1.1 over TCP/TLS.

### Interview Sentence

> HTTP/1.1 is the universal simple baseline, HTTP/2 adds binary framing and multiplexed streams over one TCP connection, and HTTP/3 moves the same general HTTP semantics onto QUIC over UDP to avoid TCP-level head-of-line blocking and improve behavior on lossy networks. In practice, I enable HTTP/2 for modern HTTPS, keep HTTP/1.1 as fallback, and use HTTP/3 at the edge when the platform and networks support it. Clients and servers negotiate HTTP/2 with TLS ALPN, while HTTP/3 is usually discovered with Alt-Svc or HTTPS DNS records and then negotiated as `h3` over QUIC.

### Follow-Up Angles

- HTTP/2 multiplexing solves HTTP/1.1's need for many parallel connections, but not TCP-level head-of-line blocking.
- HTTP/3 needs UDP to work; if UDP is blocked, fallback is normal.
- The application mostly sees the same HTTP concepts: method, path, headers, status, body.
- The edge and the origin do not need to use the same HTTP version; a CDN may speak HTTP/3 to browsers and HTTP/1.1 or HTTP/2 to the origin.
- Protocol version is often an operational/platform decision more than an application-code decision.

### Sources

- [MDN: Evolution of HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Evolution_of_HTTP)
- [MDN: ALPN](https://developer.mozilla.org/docs/Glossary/ALPN)
- [MDN: Alt-Svc](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Alt-Svc)
- [IETF RFC 9113: HTTP/2](https://www.ietf.org/rfc/rfc9113.pdf)
- [IETF RFC 9114: HTTP/3](https://www.ietf.org/rfc/rfc9114.pdf)
- [Cloudflare Radar HTTP request data docs](https://developers.cloudflare.com/radar/investigate/http-requests)

### Follow-Up: Checking HTTP Version in Safari

In Safari Web Inspector:

1. Open Web Inspector.
2. Go to the Network tab.
3. Find the request list/table, not the selected request's detail pane.
4. Right-click the request table's column header row.
5. Enable the `Protocol` column.
6. Reload the page.

If the visible panel says `Preview`, `Headers`, `Cookies`, `Sizes`, `Timing`, and `Security`, that is the detail view for one selected request. The `Protocol` setting is not there. It is in the header row of the request list, usually the table that contains many network requests.

The `Protocol` column should show values such as `http/1.1`, `h2`, or `h3`.

If the column is not visible or Safari does not show the expected value, use command-line checks:

```bash
curl -I --http1.1 https://example.com
curl -I --http2 https://example.com
curl -I --http3 https://example.com
```

Useful verbose check:

```bash
curl -v --http2 https://example.com
```

Look for ALPN output such as:

```text
ALPN: server accepted h2
```

Notes:

- Different resources on the same page may use different protocols because they come from different origins.
- Safari may first use HTTP/2, learn HTTP/3 availability through `Alt-Svc`, and use HTTP/3 on later requests.
- Cached responses can confuse inspection, so reload with cache disabled if needed.
