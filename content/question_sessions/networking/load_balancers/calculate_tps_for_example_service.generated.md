# Calculate Theoretical TPS for a Service Behind a Load Balancer


## Question

How many concurrent requests from different clients can a service at `example.com` serve if each read request takes 500 ms and each request reaches a single SQL database? Assume a load balancer, downstream app servers, and calculate theoretical maximum TPS.

## 2026-06-17

### Clue

The key idea: TPS is limited by the narrowest stage in the request path.

```text
client
  -> load balancer
    -> app servers
      -> SQL database
```

The formula for each stage is roughly:

```text
TPS = concurrency / latency_seconds
```

or rearranged:

```text
required_concurrency = TPS * latency_seconds
```

If each request takes 500 ms end to end:

```text
one in-flight slot completes 2 requests/second
```

So 1,000 concurrent in-flight requests can theoretically produce:

```text
1,000 / 0.5 = 2,000 TPS
```

### Assumptions

Example setup:

```text
example.com
  -> cloud L7 load balancer
    -> 20 app servers
      -> 1 primary SQL database with read replicas disabled
```

Load balancer assumptions:

- 1 logical cloud load balancer.
- 3 provider-managed data-plane zones.
- HTTPS listener on port 443.
- HTTP/2 from clients to load balancer.
- HTTP/1.1 keep-alive from load balancer to app servers.
- Load balancer capacity is not the bottleneck.

App server assumptions:

- 20 app servers.
- Each app server can safely process 200 concurrent requests.
- Each request holds one DB connection while waiting for the SQL query.
- App processing outside DB is small.

Database assumptions:

- Single SQL database.
- Database connection pool total across all app servers is capped at 1,000 active DB connections.
- Database can run at most 1,000 concurrent useful read queries before saturation.
- Average request latency is 500 ms, including DB time.
- Ignore cache, lock contention, network jitter, and result serialization.

### App Server Capacity

Each app server:

```text
200 concurrent requests
500 ms per request
```

Per app server theoretical TPS:

```text
200 / 0.5 = 400 TPS
```

20 app servers:

```text
20 * 400 = 8,000 TPS
```

So the app tier can theoretically serve:

```text
8,000 TPS
```

### Database Capacity

The single SQL database can handle:

```text
1,000 concurrent read queries
500 ms per request
```

Theoretical DB-limited TPS:

```text
1,000 / 0.5 = 2,000 TPS
```

### System Maximum

The system maximum is the minimum of the tier capacities:

```text
load balancer: assume > 8,000 TPS
app tier:       8,000 TPS
database:       2,000 TPS
```

Therefore:

```text
theoretical max TPS = 2,000 TPS
```

The database is the bottleneck.

### Required Concurrency for Target TPS

If the target is 10,000 TPS and latency remains 500 ms:

```text
required in-flight requests = 10,000 * 0.5 = 5,000
```

If every request needs one active DB query, the database tier would need to handle about:

```text
5,000 concurrent useful reads
```

The current assumed DB capacity is only:

```text
1,000 concurrent reads
```

So the system cannot hit 10,000 TPS without changing something.

### What Would Increase TPS?

Options:

- Add caching so not every request hits SQL.
- Add read replicas if reads can tolerate replica lag.
- Reduce DB query latency from 500 ms to 100 ms.
- Reduce DB connection hold time.
- Batch or precompute expensive reads.
- Partition/shard data if the bottleneck is data volume or write/read hot spots.
- Add app servers only if app tier is the bottleneck.

Latency improvement example:

```text
1,000 DB concurrent queries / 0.1s = 10,000 TPS
```

Same DB concurrency, lower average query/request time.

Read replica example:

```text
5 replicas * 1,000 concurrent reads each / 0.5s = 10,000 TPS
```

This only works if reads can be distributed and replica lag is acceptable.

Cache example:

If 80% of requests are served from cache and only 20% hit SQL:

```text
database TPS needed = total TPS * 0.2
```

For 10,000 total TPS:

```text
DB TPS = 2,000
```

That fits the assumed DB limit.

### Interview Sentence

> I would model each tier by concurrency divided by latency and then take the minimum across the path. If requests take 500 ms, each in-flight slot gives about 2 TPS. With 20 app servers at 200 concurrent requests each, the app tier can do about 8,000 TPS. But if every request hits one SQL database capped at 1,000 concurrent useful reads, the database tier can only do 1,000 / 0.5 = 2,000 TPS, so the system is database-bound. To increase TPS, I would reduce DB latency, add caching, add read replicas if consistency allows, or change the data model before simply adding more app servers.
