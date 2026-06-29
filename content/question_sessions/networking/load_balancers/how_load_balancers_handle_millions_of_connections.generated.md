# How Load Balancers Handle Millions of Connections


## Question

How does a load balancer handle millions of connections at the same time? Can a single load balancer do this? There is a single origin like `example.com` but to handle millions of connections it has to distribute the connections. What is the "it"? Is it a single entity? Many servers acting like load balancers? How does the server-side select which load balancer handles the request?

## 2026-06-17

### Clue

The key idea: `example.com` is one name, not necessarily one machine.

At scale, the "load balancer" is usually a distributed system:

```text
DNS / anycast / edge routing
  -> load balancer fleet
    -> backend service fleet
```

So the "it" is often not a single server. It is a layer of infrastructure that gets traffic to one of many load-balancing instances, and those instances then select healthy backends.

### The Simple Version

Small setup:

```text
client
  -> DNS: example.com = 203.0.113.10
  -> one load balancer at 203.0.113.10
  -> app-server-1 / app-server-2 / app-server-3
```

This can work for moderate traffic. But for very large traffic, one box or one IP endpoint can become a bottleneck or a single point of failure.

Large setup:

```text
client
  -> DNS / anycast chooses a nearby edge/load-balancer location
  -> one load balancer instance in that fleet receives the connection
  -> it forwards/proxies to a healthy backend
```

### How Does the Client Reach a Load Balancer?

#### DNS

DNS can return one or more IP addresses for `example.com`.

Example:

```text
example.com -> 198.51.100.10
example.com -> 198.51.100.11
example.com -> 198.51.100.12
```

Different clients may get different answers based on:

- geography,
- latency,
- health,
- provider policy,
- weighted routing,
- failover rules.

DNS is coarse-grained because clients and resolvers cache answers.

#### Anycast

With anycast, the same IP address is announced from many locations.

```text
example.com -> 203.0.113.5

203.0.113.5 announced in:
  Istanbul edge
  Frankfurt edge
  London edge
  Virginia edge
```

Internet routing usually sends the client to a nearby or topologically preferred location advertising that same IP.

So one IP can represent many physical load-balancing sites.

#### Cloud Load Balancer Frontend

In AWS/GCP/Azure, the cloud load balancer often presents one stable DNS name or IP, but internally the provider runs a distributed fleet.

From the user's perspective:

```text
my-lb.example-cloud.com
```

From the provider's perspective:

```text
many data-plane nodes across zones/locations
```

### What Does a Load Balancer Instance Do?

Once traffic reaches a load-balancer instance, it picks a backend.

It considers things like:

- backend health,
- backend weight/capacity,
- active connections,
- request count,
- latency,
- locality/zone,
- sticky session key,
- hash of client IP or request field.

For L4 load balancing:

```text
TCP/UDP connection-level routing
```

For L7 load balancing:

```text
HTTP-aware routing by host/path/header/cookie
```

Example L7 routing:

```text
api.example.com/payments -> payments service
api.example.com/orders   -> orders service
```

### Can a Single Load Balancer Handle Millions of Connections?

It depends what "single" means.

A single high-performance process or machine can handle a very large number of connections if it is designed well:

- event-driven I/O,
- efficient kernel networking,
- high file descriptor limits,
- enough memory,
- enough NIC bandwidth,
- optimized TLS handling,
- possibly kernel bypass or hardware offload.

But production systems usually avoid relying on one machine.

At large scale, "a load balancer" usually means:

```text
a logical load balancer backed by many physical/virtual load-balancer instances
```

This gives:

- more capacity,
- redundancy,
- zone/region resilience,
- rolling maintenance,
- fault tolerance.

### Where Is Connection State Kept?

For TCP, a specific connection must be consistently handled.

If a load balancer is proxying the connection:

```text
client TCP connection -> load balancer
load balancer TCP connection -> backend
```

that load-balancer instance owns connection state until close.

If the load balancer is doing packet-level forwarding, it still needs consistent flow handling so packets from the same connection go to the same backend.

The flow key is often based on the 5-tuple:

```text
source IP
source port
destination IP
destination port
protocol
```

### What Happens with WebSockets?

WebSockets make the connection-state point more obvious.

For normal HTTP requests, the load balancer can make a backend decision per request.

For WebSockets:

```text
client -> load balancer -> backend
```

the backend is selected during connection setup, and that long-lived connection stays mapped to that backend path until close.

So load balancers for WebSockets care about:

- active connection count,
- idle timeouts,
- draining,
- connection stickiness,
- backend health,
- reconnect behavior.

### The "Server-Side Selection" Question

There are two selection stages:

1. Which load-balancer location/instance does the client reach?
2. Which backend does that load-balancer instance choose?

For stage 1:

```text
DNS, anycast, cloud provider routing, edge routing
```

For stage 2:

```text
load-balancing algorithm and backend health state
```

The app servers usually do not select the load balancer. The infrastructure in front of them does.

### Interview Sentence

> At scale, a load balancer is usually a logical service backed by a fleet, not one box. A single hostname can resolve through DNS or anycast to a nearby or healthy load-balancing location, and that load-balancing layer then selects a healthy backend using L4 flow rules or L7 HTTP routing. For TCP and WebSockets, connection state matters, so a given connection must stay on a consistent load-balancer/backend path until it closes. The main scaling trick is splitting the problem into global traffic distribution to load-balancer instances and local/backend distribution from those instances to application servers.

### Follow-Up Angles

- DNS load balancing is coarse because of caching.
- Anycast lets one IP represent many edge locations.
- L4 load balancers route flows; L7 load balancers understand HTTP.
- Health checks prevent routing to dead backends.
- Connection draining prevents deploys from dropping live traffic abruptly.
- Load balancers can themselves hit limits: connection tables, TLS CPU, memory, bandwidth, ephemeral ports, and idle timeouts.
- Cloud load balancers hide a large distributed data plane behind one logical resource.

### Follow-Up: How Do We Get a Particular Load Balancer?

The client does not usually choose a named load-balancer machine.

It starts with:

```text
connect to example.com
```

Then infrastructure turns that name into a network path.

There are three common patterns.

## Pattern 1: DNS Chooses an IP

Flow:

```text
browser
  -> recursive DNS resolver
    -> authoritative DNS for example.com
      -> returns one or more IPs
browser
  -> connects to returned IP
```

Example DNS answer:

```text
example.com -> 198.51.100.10
example.com -> 198.51.100.11
```

The authoritative DNS provider may choose the answer based on:

- client resolver location,
- geo routing,
- latency measurements,
- health checks,
- weighted rules,
- failover config.

Then the client connects to one of those IPs. That IP may represent one load balancer or a fleet behind the scenes.

Important: DNS usually sees the recursive resolver, not always the exact end-user device. So DNS routing is approximate.

Also, DNS answers are cached according to TTL, so DNS is not perfect per-request load balancing.

## Pattern 2: Anycast Chooses the Location

Flow:

```text
example.com -> 203.0.113.5
```

But `203.0.113.5` is announced from many locations:

```text
Istanbul edge announces 203.0.113.5
Frankfurt edge announces 203.0.113.5
London edge announces 203.0.113.5
Virginia edge announces 203.0.113.5
```

Internet routing, through BGP, sends the client's packets toward one of those locations.

The client thinks:

```text
I am connecting to 203.0.113.5
```

But the internet decides which physical site advertising `203.0.113.5` receives the packets.

The "chosen load balancer" is therefore selected by network routing, not by application code.

Anycast is common for:

- CDNs,
- DNS providers,
- DDoS-protected edges,
- global load-balancing edges.

## Pattern 3: Cloud Load Balancer Frontend

In cloud providers, you may create:

```text
my-app-lb
```

and get:

```text
my-app-lb-123.region.elb.amazonaws.com
```

or a stable IP depending on provider/product.

You point your domain to it:

```text
example.com CNAME my-app-lb-123.region.elb.amazonaws.com
```

From your perspective:

```text
one logical load balancer
```

Provider internally:

```text
many load-balancer data-plane nodes
spread across zones
scaled and replaced by provider
```

DNS and provider routing get the client to one of those data-plane nodes.

You usually do not pick the exact data-plane node. The provider's infrastructure does.

## A Concrete Request Path

Say you open:

```text
https://example.com/payments
```

Step by step:

1. Browser asks DNS: "what is `example.com`?"
2. DNS returns an IP, or a CNAME chain ending in provider-managed IPs.
3. Browser opens TCP/TLS to that IP.
4. Internet routing delivers packets to the selected edge/load-balancer location.
5. One load-balancer instance/data-plane node accepts the connection.
6. That load balancer chooses a backend service/server.
7. Request reaches the app.

The app server did not choose which load balancer received the request. That happened before the app server was involved.

## Who Is Making the Decision?

Depending on architecture:

```text
DNS provider chooses which IP answer to give.
Internet routing/BGP chooses which anycast site receives packets.
Cloud provider load-balancer fabric chooses which data-plane node handles the flow.
Load-balancer instance chooses which backend receives the request.
```

So "which load balancer do I get?" is usually answered by a combination of:

```text
DNS + routing + provider infrastructure
```

not a single application-level decision.

## Important Nuance: Per Request vs Per Connection

For plain HTTP/1.1 without keep-alive, a new request might mean a new connection.

For modern HTTP:

- HTTP/1.1 keep-alive reuses connections.
- HTTP/2 multiplexes many requests over one connection.
- HTTP/3 uses QUIC connection semantics.

So the first-stage selection often happens per connection, not per individual HTTP request.

Once the browser has an open HTTP/2 connection to an edge/load balancer, many requests can reuse that same connection.

## Interview Sentence

> The client does not usually choose a specific load-balancer machine. It resolves the hostname through DNS, and the returned IP may be selected by geo, latency, health, or weighted DNS policy. That IP may also be anycast, where BGP routes the client to one of many physical edge locations advertising the same address. In cloud load balancers, the DNS name or frontend IP represents a provider-managed fleet of data-plane nodes. So the first-stage selection is handled by DNS, internet routing, and provider infrastructure before the request ever reaches an application backend.

### Follow-Up: Logical Cloud Load Balancer vs Data-Plane Nodes

When you create a cloud load balancer, you usually interact with one logical resource:

```text
LoadBalancer: my-public-api-lb
DNS name: my-public-api-lb.provider.com
listeners:
  443 -> target group payments-api
```

That is the control-plane view.

It is the thing you configure:

- listeners,
- certificates,
- health checks,
- backend target groups,
- routing rules,
- security settings,
- zones/subnets.

But the packets are handled by a data plane.

The data plane is the provider-managed fleet that actually accepts connections and forwards/proxies traffic.

Conceptually:

```text
my-public-api-lb.provider.com
  -> data-plane node A in zone-1
  -> data-plane node B in zone-2
  -> data-plane node C in zone-3
  -> more hidden provider capacity as needed
```

You do not SSH into these nodes. You usually do not see their hostnames. The cloud provider operates them.

#### Control Plane vs Data Plane

Control plane:

```text
stores desired load balancer config
accepts API changes
provisions capacity
updates routing rules
tracks health check config
```

Data plane:

```text
accepts client connections
terminates TLS if configured
keeps connection/flow state
selects healthy backend targets
forwards/proxies packets or requests
emits metrics/logs
```

The user sees:

```text
one load balancer object
```

The provider runs:

```text
many load-balancing workers/data-plane nodes
```

#### Why Hide the Data-Plane Nodes?

Because the provider needs freedom to:

- add capacity,
- remove unhealthy LB nodes,
- patch/upgrade nodes,
- shift traffic between zones,
- replace machines,
- absorb failures,
- scale during traffic spikes.

If users depended on specific LB machines, the provider could not safely manage the fleet.

#### What Does DNS Point To?

The cloud LB DNS name may resolve to multiple IPs:

```text
my-public-api-lb.provider.com -> 198.51.100.10
my-public-api-lb.provider.com -> 198.51.100.11
my-public-api-lb.provider.com -> 198.51.100.12
```

Those IPs represent provider-managed frontend capacity.

Depending on provider/product, they may map to:

- per-zone load-balancer nodes,
- anycast frontends,
- regional frontend systems,
- edge proxy fleets,
- software-defined network fabric.

Exact implementation differs by cloud and LB product, but the mental model is the same: stable logical frontend, hidden distributed data plane.

#### What Happens When Traffic Grows?

From the user's perspective:

```text
same LB DNS name
same listener
same target group
```

Provider may internally:

- add more data-plane capacity,
- rebalance traffic,
- add IPs to DNS,
- scale proxy workers,
- move flows away from unhealthy nodes.

Some cloud load balancers scale automatically. Others have documented limits, warm-up behavior, or quota considerations.

#### What About Backend Selection?

Once a data-plane node receives a connection/request, it selects from registered backend targets:

```text
target group:
  app-server-1 healthy
  app-server-2 healthy
  app-server-3 unhealthy
```

Then it routes only to healthy targets according to the load-balancing algorithm and configured rules.

So the full model is:

```text
client
  -> cloud LB DNS/front-end IP
    -> provider data-plane node
      -> healthy backend target
```

#### Interview Sentence

> In a cloud load balancer, the object I configure is a logical control-plane resource: listeners, certificates, routing rules, health checks, and target groups. The actual traffic is handled by a provider-managed data plane: multiple hidden load-balancing nodes or proxy workers across zones or regions. The DNS name or frontend IP represents that fleet, and the provider can scale, replace, patch, and rebalance the data-plane nodes without exposing them individually to me.
