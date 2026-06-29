# Database Connection Pooling


## Question

How do connection pools work, how can they overload a database, and how does this tie to networking and TCP?

## 2026-06-17

### Clue

The key idea: a database connection is not just a cheap function call.

It is usually:

```text
application object
  -> database client connection
    -> TCP socket
      -> database backend/session/process/thread/state
```

A connection pool reuses a limited number of already-open database connections instead of opening a new TCP/database session for every request.

### Why Pool Connections?

Opening a database connection has costs:

- TCP handshake,
- TLS handshake if enabled,
- authentication,
- database session setup,
- memory on the database,
- process/thread/session state,
- query planning/cache/session settings depending on DB.

Without pooling:

```text
request arrives
open DB connection
run query
close DB connection
```

That wastes time and can overload the database with connection churn.

With pooling:

```text
app starts
opens 20 DB connections

request arrives
borrows connection from pool
runs query
returns connection to pool
```

### Concrete Example

One app server:

```text
pool size = 20
```

That means the app can have up to 20 active DB operations at the same time from that process/server.

If 100 HTTP requests arrive at once:

```text
20 use DB connections
80 wait in the app pool queue
```

This is often good. It creates backpressure before the database is overwhelmed.

### How Pools Overload Databases

The danger appears when scaling app servers.

Example:

```text
50 app servers
pool size = 50 per server
```

Total possible DB connections:

```text
50 * 50 = 2,500 DB connections
```

If the database is comfortable with only 300 active connections, the app fleet can overload it even though each app server's pool size looks reasonable locally.

This is a common senior-interview point:

```text
per-instance pool size * number of instances = total DB pressure
```

### TCP and Networking Connection

A database connection is commonly backed by a TCP connection.

Example:

```text
app server 10.0.1.20:51432
  -> postgres 10.0.2.10:5432
```

That TCP connection consumes:

- a file descriptor in the app process,
- a file descriptor/socket on the database side,
- memory buffers,
- kernel socket state,
- possibly TLS state,
- database session/backend state.

So connection pooling is also resource pooling at the networking/OS level.

### Pool Size vs Query Concurrency

Pool size is a concurrency limit.

If:

```text
pool size = 20
average DB time = 50 ms
```

Then theoretical DB operation throughput from that app instance:

```text
20 / 0.05 = 400 DB ops/sec
```

If DB time becomes 500 ms:

```text
20 / 0.5 = 40 DB ops/sec
```

Same pool, lower throughput because connections are held longer.

### Pool Queueing

When all pool connections are busy, new requests wait.

This is not automatically bad. It can protect the database.

But queues must have limits:

- max wait time,
- request timeout,
- max queue length,
- circuit breaker/backpressure.

Otherwise app servers can build huge queues and create latency spikes.

### Transaction Pooling vs Session Pooling

Some tools, like PgBouncer, can pool connections between many app instances and PostgreSQL.

Session pooling:

```text
client holds server connection for entire session
```

Transaction pooling:

```text
client gets server connection only for one transaction
```

Transaction pooling lets many app connections share fewer database server connections, but it can break features that depend on session state:

- temporary tables,
- session variables,
- prepared statements in some modes,
- LISTEN/NOTIFY patterns,
- connection-local settings.

### Common Mistakes

- Setting pool size too high on every app server.
- No timeout when waiting for a pool connection.
- Holding a DB connection while calling external APIs.
- Doing slow work inside a transaction.
- Long-running queries occupying pool slots.
- Leaking connections by not returning them to the pool.
- Forgetting that autoscaling app servers increases total possible DB connections.

### How to Size a Pool

Start from database capacity, not just app preference.

Example:

```text
database can safely handle 300 active connections
app has 30 instances
```

Rough per-instance pool budget:

```text
300 / 30 = 10 connections per app instance
```

Leave headroom for:

- migrations,
- admin sessions,
- background workers,
- monitoring,
- failover,
- traffic bursts.

### Interview Sentence

> A database connection pool keeps a bounded set of reusable database connections, which are usually backed by TCP sockets and database session state. It avoids per-request connection setup cost and creates a concurrency limit before the database. The trap is that pool size is per app instance, so total database pressure is pool size times number of instances. If I scale from 10 to 100 app servers with a pool of 50 each, I may create 5,000 possible database connections and overload Postgres. I would size pools from database capacity, use timeouts and backpressure, avoid holding connections during slow non-DB work, and consider PgBouncer or transaction pooling where appropriate.

### Follow-Up Angles

- Pool size limits concurrent DB work, not total HTTP traffic.
- Long query latency reduces throughput because connections are held longer.
- Connection pooling is tied to TCP sockets, file descriptors, kernel state, and DB backend/session memory.
- PgBouncer can reduce server-side PostgreSQL connection pressure.
- Autoscaling app servers must be coordinated with database connection budgets.

### Follow-Up: Pooling, Autoscaling, and Global Connection Budgets

Your instinct is right.

If the pool is inside each application process, autoscaling app instances multiplies total possible database connections.

```text
total possible DB connections = app instance count * pool size per instance
```

Example:

```text
10 app instances * pool size 20 = 200 possible DB connections
50 app instances * pool size 20 = 1,000 possible DB connections
```

If PostgreSQL is comfortable with 300 active connections, scaling from 10 to 50 app instances can suffocate the database unless something else controls the total.

#### Where Can Pooling Happen?

There are multiple possible layers.

App-side pool:

```text
app process
  -> local pool of DB connections
    -> PostgreSQL
```

This is common in app frameworks and DB clients.

Proxy-side pool:

```text
app processes
  -> PgBouncer / RDS Proxy / database proxy
    -> smaller pool of PostgreSQL server connections
```

This centralizes or reduces pressure on the database.

Database server itself:

```text
PostgreSQL accepts connections
```

PostgreSQL has connection/session management, but it is not a pooling layer in the same sense. Each PostgreSQL connection has server-side cost. That is exactly why too many direct connections can hurt.

#### Pattern 1: Conservative Fixed Per-Instance Pool

Pick a max app instance count and divide the DB budget.

Example:

```text
DB safe connection budget for app = 300
max app instances = 30
```

Per-instance pool:

```text
300 / 30 = 10
```

Set:

```text
pool size = 10
```

Even if autoscaling reaches 30 instances:

```text
30 * 10 = 300
```

This is simple and safe, but when only 5 instances are running:

```text
5 * 10 = 50
```

you may underuse possible DB concurrency.

#### Pattern 2: Dynamic Pool Sizing

In theory, app instances could compute:

```text
pool size = DB connection budget / current app instance count
```

Example:

```text
300 / 10 instances = 30 each
300 / 30 instances = 10 each
```

This is harder operationally because all instances need reliable coordination and safe reconfiguration. Many teams avoid this unless they have strong platform support.

#### Pattern 3: Put a Pooler/Proxy Between Apps and DB

Example:

```text
100 app instances
  each may open app-side connections to PgBouncer
PgBouncer
  maintains 300 real PostgreSQL server connections
PostgreSQL
```

This lets many app connections share fewer database server connections.

For PostgreSQL, common options:

- PgBouncer,
- cloud proxies such as RDS Proxy depending on provider/database,
- platform-managed poolers.

This is especially useful with many app instances, serverless functions, or bursty traffic.

Tradeoff: transaction pooling can break session-dependent features.

#### Pattern 4: Autoscaling Guardrails

Autoscaling should be configured with DB capacity in mind.

Guardrails:

- max app replica count,
- conservative per-instance pool size,
- queue/request timeouts,
- circuit breakers,
- HPA based on app and DB signals,
- alerts on DB connections and wait times,
- separate worker concurrency limits,
- backpressure before the DB is exhausted.

Bad autoscaling:

```text
latency rises
HPA adds app servers
new app servers add DB connections
DB gets more overloaded
latency rises more
HPA adds more servers
```

This is a positive feedback loop.

#### A Concrete Kubernetes Example

Deployment:

```text
payments-api replicas: 10 to 50
DB safe app connection budget: 300
```

If no PgBouncer:

```text
pool size should be at most 300 / 50 = 6
```

Maybe set:

```text
DB_POOL_SIZE=5
```

Then max:

```text
50 * 5 = 250
```

leaving room for migrations, admin sessions, monitoring, and background jobs.

If PgBouncer is used:

```text
app -> PgBouncer many client connections
PgBouncer -> PostgreSQL max 300 server connections
```

App pool size still should not be unlimited, but PostgreSQL is protected by the proxy-side server connection cap.

#### Interview Sentence

> Most application connection pools are per process or per app instance, so autoscaling multiplies total possible database connections. I would define a global database connection budget, reserve headroom, and set per-instance pool sizes based on the maximum replica count, or use a pooler like PgBouncer/RDS Proxy to cap real database server connections. I would also put timeouts and backpressure on pool acquisition, because otherwise autoscaling app servers can create a feedback loop where more app capacity causes more database overload.

### Follow-Up: Backpressure and Circuit Breaker

Backpressure and circuit breakers are both protection mechanisms, but they answer different problems.

```text
backpressure    = "slow down or reject work because capacity is full"
circuit breaker = "stop calling this dependency because it is failing"
```

#### Backpressure

Backpressure means the system refuses to accept unlimited work when a downstream resource is already saturated.

Example with a database pool:

```text
DB pool size = 10
10 connections are busy
new request needs DB
```

Bad behavior:

```text
queue forever
keep accepting requests
memory grows
latency explodes
database gets more overloaded
```

Backpressure behavior:

```text
wait up to 100 ms for a DB connection
if none is available, fail fast with 503 or shed low-priority work
```

Backpressure mechanisms:

- bounded queues,
- timeouts,
- max concurrent requests,
- max in-flight DB operations,
- rate limiting,
- rejecting low-priority traffic,
- load shedding,
- slowing producers,
- returning `429 Too Many Requests` or `503 Service Unavailable`.

The key idea:

> A bounded system must have a policy for what happens when the bound is reached.

Interview sentence:

> Backpressure is how a service protects itself and its dependencies by bounding in-flight work. If the database pool, queue, or worker capacity is full, the service should wait only briefly, reject, shed, or slow incoming work rather than queueing forever and turning overload into a full outage.

#### Circuit Breaker

A circuit breaker protects a system from repeatedly calling a dependency that is already failing.

Electrical analogy:

```text
too much failure/current -> circuit opens -> stop sending traffic
```

Service example:

```text
payments-api -> fraud-service
```

If `fraud-service` starts timing out, normal retry behavior can make things worse:

```text
request times out
retry
retry
retry
more load on already failing service
threads/connections pile up
payments-api also becomes unhealthy
```

Circuit breaker behavior:

```text
failure rate crosses threshold
circuit opens
new calls fail fast or use fallback
after cooldown, allow a few test calls
if healthy, close circuit
if still failing, keep open
```

Common states:

```text
closed    = normal calls flow
open      = calls fail fast / fallback
half-open = allow limited trial calls to check recovery
```

Circuit breaker knobs:

- failure threshold,
- timeout threshold,
- rolling window size,
- open duration/cooldown,
- half-open trial count,
- fallback behavior.

Interview sentence:

> A circuit breaker watches calls to a dependency and opens when failures or timeouts exceed a threshold. While open, it fails fast or uses a fallback instead of continuing to pile traffic onto a failing dependency. After a cooldown, it enters half-open mode and allows limited test calls; if they succeed, it closes, and if they fail, it opens again.

#### Difference in One Example

Suppose `payments-api` needs PostgreSQL.

Backpressure:

```text
Postgres is not necessarily failing,
but all DB pool slots are busy.
payments-api limits waiting and rejects excess requests.
```

Circuit breaker:

```text
Postgres calls are timing out/failing repeatedly.
payments-api temporarily stops trying DB calls and fails fast.
```

They often work together:

```text
timeout prevents long hangs
backpressure limits in-flight work
circuit breaker stops repeated calls to unhealthy dependency
```

#### Why This Matters in Scaling

Without these mechanisms, overload spreads.

```text
database slows down
app requests hold DB connections longer
pool fills
app threads/tasks queue up
latency rises
autoscaler adds more app instances
more instances open more DB connections
database gets worse
```

Backpressure and circuit breakers stop that cascade.
