# PgBouncer and Database Poolers


## Question

What problem does PgBouncer solve, how does it solve it, and do other databases have similar counterparts?

## 2026-06-17

### Clue

The key idea: PgBouncer protects PostgreSQL from too many client connections by multiplexing many application-side connections over fewer PostgreSQL server connections.

Without PgBouncer:

```text
100 app instances * 50 pool size = 5,000 PostgreSQL connections
```

With PgBouncer:

```text
many app connections
  -> PgBouncer
    -> smaller fixed pool of real PostgreSQL connections
```

### Problem It Solves

PostgreSQL connections are relatively expensive.

Each connection has server-side costs:

- backend process/session state,
- memory,
- file descriptors/sockets,
- authentication/session setup,
- transaction/session state,
- planner/cache/session settings.

If autoscaling creates too many app instances, each with its own pool, PostgreSQL can become overloaded by connection count before query work is even the main bottleneck.

### How PgBouncer Solves It

PgBouncer sits between apps and PostgreSQL:

```text
app instances
  -> PgBouncer
    -> PostgreSQL
```

Apps connect to PgBouncer as if it were PostgreSQL.

PgBouncer maintains a smaller pool of actual PostgreSQL server connections and assigns them to clients according to pooling mode.

### Pooling Modes

#### Session Pooling

```text
client gets a server connection for the whole client session
```

Most compatible, less efficient multiplexing.

#### Transaction Pooling

```text
client gets a server connection only for one transaction
```

Much better multiplexing.

But it can break session-dependent features:

- temporary tables,
- session variables,
- some prepared statement behavior,
- LISTEN/NOTIFY,
- connection-local settings,
- assumptions about always using the same backend connection.

#### Statement Pooling

```text
server connection is returned after each statement
```

Most restrictive, less commonly suitable for normal applications.

### Concrete Example

App fleet:

```text
80 app instances
each can open 20 client connections
```

Potential app-side connections:

```text
80 * 20 = 1,600
```

PgBouncer config:

```text
max client connections = 2,000
default pool size = 200
```

PostgreSQL sees roughly:

```text
200 server connections
```

not:

```text
1,600 server connections
```

This does not make the database do unlimited query work. It controls connection pressure and queues/multiplexes access to PostgreSQL.

### What PgBouncer Does Not Solve

PgBouncer does not make slow queries fast.

It does not solve:

- missing indexes,
- bad query plans,
- CPU saturation from real query work,
- lock contention,
- disk I/O bottlenecks,
- write throughput limits,
- bad schema design.

It mainly solves connection management and protects PostgreSQL from connection explosion.

### Similar Counterparts

The general category is:

```text
database proxy / connection pooler / connection multiplexing layer
```

Examples:

- PostgreSQL: PgBouncer, Pgpool-II, Odyssey, cloud proxies such as RDS Proxy.
- MySQL: ProxySQL, MySQL Router, MaxScale, cloud proxies such as RDS Proxy.
- SQL Server: client-side pooling is common in drivers; middle-tier/proxy patterns exist but are less PgBouncer-like as a default mental model.
- Oracle: DRCP, connection pooling in drivers/app servers.

Many ecosystems also rely heavily on client-side pooling in the application driver/framework.

### Interview Sentence

> PgBouncer is a lightweight PostgreSQL connection pooler that sits between applications and Postgres. It accepts many client connections but maintains a smaller pool of real server connections, reducing connection churn and protecting Postgres from too many backend sessions. In transaction pooling mode it can multiplex many app connections over fewer database connections, but that comes with compatibility tradeoffs around session state. Other databases have similar proxy or pooler patterns, such as ProxySQL for MySQL or cloud database proxies, but exact behavior depends on the database protocol and session model.

### Follow-Up Angles

- PgBouncer controls connection pressure, not query CPU by itself.
- Transaction pooling is powerful but can break session-dependent behavior.
- App-side pools still need sane limits even with PgBouncer.
- PgBouncer can become its own bottleneck if undersized or deployed as a single point of failure.
- In Kubernetes, PgBouncer may run as a sidecar, per-node daemon, shared Deployment, or managed external service depending on architecture.

### Follow-Up: Which Pooling Mode Is Most Common?

The practical answer:

```text
session pooling = safest / most compatible
transaction pooling = common when the goal is serious connection reduction
statement pooling = uncommon for normal apps
```

#### Session Pooling Is the Safest Default

Session pooling gives one client connection a server connection for the duration of that client session.

This preserves normal PostgreSQL session behavior:

- session variables,
- temporary tables,
- prepared statements,
- connection-local settings,
- LISTEN/NOTIFY,
- assumptions made by many ORMs/drivers.

Because it changes application behavior the least, it is the lowest-risk mode.

Downside:

```text
less multiplexing
```

If an app opens 1,000 long-lived client sessions, PgBouncer may still need many server connections depending on workload and pool settings.

#### Transaction Pooling Is Common for Scaling

Transaction pooling returns the server connection to the pool after each transaction.

This is where PgBouncer becomes much more powerful:

```text
many app clients
share fewer PostgreSQL server connections
one transaction at a time
```

It is common in high-scale PostgreSQL setups because it directly addresses connection explosion.

Good fit when:

- app does short transactions,
- app does not depend on session state,
- ORM/driver is configured compatibly,
- prepared statement behavior is understood,
- workload is request/transaction-oriented.

Bad fit when the app relies on:

- temp tables across transactions,
- session-level settings,
- connection-specific state,
- LISTEN/NOTIFY,
- long-lived transactions,
- assumptions that the same client keeps the same PostgreSQL backend connection.

#### Statement Pooling Is Rare

Statement pooling returns the server connection after every statement.

It is very restrictive because multi-statement transactions are difficult or impossible in normal form.

Most real applications need transactions, so statement pooling is not usually the main choice.

#### Interview Sentence

> Session pooling is the safest and most compatible PgBouncer mode because it preserves normal PostgreSQL session behavior. Transaction pooling is very common when the goal is to significantly reduce PostgreSQL server connections, because it lets many client connections share fewer server connections one transaction at a time. The tradeoff is compatibility: transaction pooling can break features that depend on session state, so the choice depends on whether the application and ORM can operate cleanly without connection-local assumptions.
