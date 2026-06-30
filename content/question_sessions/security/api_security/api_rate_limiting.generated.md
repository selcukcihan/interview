# API Rate Limiting

## Question

How would you design rate limiting for an API, and what algorithms and tradeoffs matter?

## Short Answer

Rate limiting controls how many requests a caller can make in a time window.

It protects against:

- abuse and scraping;
- brute force login attempts;
- accidental client bugs;
- noisy tenants;
- expensive endpoint overload;
- downstream dependency overload.

Example policy:

```text
user_123 can make 100 requests per minute to /api/search
api_key_abc can make 10,000 requests per hour globally
IP 1.2.3.4 can make 20 login attempts per minute
tenant_456 can make 500 write requests per minute
```

When the limit is exceeded, the API usually returns:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
```

## What Are We Limiting By?

The first design decision is the identity/key for the limit.

Common keys:

```text
IP address
user ID
API key
tenant/workspace ID
OAuth client ID
endpoint route
HTTP method
region
device/session
```

Examples:

```text
per IP:
  useful before login, but weak behind NAT/proxies

per user:
  useful after authentication

per API key:
  useful for developer/platform APIs

per tenant:
  useful for SaaS fairness

per endpoint:
  useful because /login and /export/report are very different costs
```

In real systems, limits are usually layered:

```text
global IP limit
per-user limit
per-tenant limit
per-endpoint limit
special low limit for login/password reset
```

## Fixed Window Counter

Policy:

```text
100 requests per minute
```

Implementation:

```text
counter key: user_123:2026-06-30T10:15
increment on each request
expire key after the window
deny if counter > 100
```

Pros:

- simple;
- fast;
- easy with Redis `INCR` + expiry.

Cons:

- boundary burst problem.

Example:

```text
100 requests at 10:15:59
100 requests at 10:16:00

200 requests in 2 seconds, even though policy says 100/minute
```

Good for simple, coarse limits.

## Sliding Window Log

Store timestamps for recent requests.

```text
user_123 -> [10:15:01, 10:15:02, 10:15:05, ...]
```

On each request:

```text
remove entries older than now - 60 seconds
count remaining entries
allow if count < limit
append current timestamp
```

Pros:

- accurate rolling window;
- no boundary burst.

Cons:

- stores one entry per request;
- expensive at high traffic;
- needs cleanup.

Good for low-volume but security-sensitive endpoints such as login attempts.

## Sliding Window Counter

Approximation of a sliding window using current and previous fixed windows.

Example:

```text
limit = 100/min
current window count = 20
previous window count = 80
current window is 25% complete

estimated count = current + previous * (1 - 0.25)
                = 20 + 80 * 0.75
                = 80
```

Pros:

- smoother than fixed window;
- cheaper than timestamp log;
- common practical choice.

Cons:

- approximate;
- still more complex than fixed counter.

## Token Bucket

Imagine each caller has a bucket of tokens.

```text
bucket capacity: 100 tokens
refill rate: 10 tokens/second
each request costs: 1 token
```

On each request:

```text
refill bucket based on elapsed time
if token available:
  consume token and allow
else:
  reject or delay
```

Pros:

- allows short bursts;
- enforces average rate over time;
- efficient;
- widely used.

Cons:

- burst capacity must be chosen carefully;
- distributed implementation needs atomic updates.

Good for public APIs where occasional bursts are acceptable.

## Leaky Bucket

Requests enter a queue/bucket and are processed at a fixed rate.

```text
incoming burst -> queue -> process 10/sec
```

If the queue is full, reject.

Pros:

- smooths traffic;
- protects downstream services.

Cons:

- adds latency;
- requires queueing;
- bad fit if clients need immediate responses.

Good when you want traffic shaping, not just rejection.

## Which Algorithm Should I Choose?

Practical defaults:

```text
login/password reset:
  sliding window log or strict counter
  key by IP + account/email + device/session

public API:
  token bucket
  key by API key/user/tenant

expensive endpoints:
  weighted token bucket
  expensive requests cost more tokens

simple internal service:
  fixed window or token bucket

fair SaaS usage:
  tenant-level token bucket + per-user guardrails
```

## Distributed Rate Limiting

If you have multiple API servers:

```text
client requests
  -> load balancer
  -> app server A/B/C
```

Rate limit state cannot live only in one app server's memory, unless you accept approximate per-node limits.

Common approaches:

### Central Store

Use Redis or another fast shared store.

```text
app server A \
app server B  -> Redis counters/buckets
app server C /
```

Pros:

- consistent across app servers;
- easy to reason about;
- good enough for many systems.

Cons:

- Redis becomes part of request path;
- latency matters;
- Redis outage policy matters;
- hot keys can happen for large tenants.

### Local Approximation

Each node keeps local counters.

```text
global limit: 1000/min
10 app nodes
each node allows 100/min
```

Pros:

- very fast;
- no central dependency.

Cons:

- inaccurate under uneven load;
- autoscaling changes math;
- clients can get more capacity if traffic spreads.

### Edge/Gateway Limiting

Rate limit at API gateway, reverse proxy, CDN, or service mesh.

Pros:

- rejects before hitting app servers;
- central policy point;
- good for IP/API-key limits.

Cons:

- gateway may not know deep application identity or cost;
- app-level authorization/tenant context may still be needed.

Real systems often combine gateway-level and application-level limits.

## Atomicity

Rate limiting updates must be atomic.

Bad:

```text
read counter = 99
request A reads 99
request B reads 99
A writes 100 and allows
B writes 100 and allows
```

Both were allowed, but one should have been denied.

Redis implementations often use:

- `INCR` with expiration for fixed windows;
- Lua scripts for multi-step token bucket logic;
- sorted sets for sliding logs.

The key requirement:

```text
check and update must happen as one atomic operation
```

## Response Design

Typical response:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{
  "error": "rate_limited",
  "message": "Too many requests. Try again later."
}
```

Useful headers:

```text
Retry-After
RateLimit-Limit
RateLimit-Remaining
RateLimit-Reset
```

Be careful exposing too much detail on security-sensitive endpoints. For login, detailed counters can help attackers optimize.

## Rate Limiting vs Throttling vs Quotas

These words are often mixed.

Useful distinction:

```text
rate limiting:
  reject or block requests over a short-term rate

throttling:
  slow down or shape traffic instead of immediately rejecting

quota:
  long-term allowance, such as 1 million requests/month
```

Example:

```text
rate limit: 100 requests/minute
quota: 1,000,000 requests/month
```

## Security-Specific Cases

### Login Attempts

Do not only limit by IP.

Attackers can rotate IPs, and many real users may share one IP.

Better layered keys:

```text
IP address
email/account identifier
IP + email pair
device/session fingerprint, if available
ASN/country/risk signals, if appropriate
```

Also use:

- exponential backoff;
- CAPTCHA or step-up verification after suspicious behavior;
- credential stuffing detection;
- account lockout carefully, because lockout can become denial-of-service.

### Password Reset

Protect:

- reset request creation;
- reset token verification attempts;
- email sending volume.

Avoid leaking whether an email exists.

### Expensive Operations

Some requests cost more than others:

```text
GET /health         cost 1
POST /search        cost 5
POST /export-csv    cost 100
```

Token bucket can support weighted costs.

## Failure Modes

### Fail Open vs Fail Closed

If Redis/rate-limit service is down:

```text
fail open:
  allow requests
  preserves availability
  weakens protection

fail closed:
  reject requests
  protects backend
  can cause outage for legitimate users
```

Common pragmatic choice:

```text
fail open for ordinary user/API traffic
fail closed or degraded for extremely expensive/risky paths
```

### NAT and Shared IPs

Many users can share one public IP:

- office network;
- university;
- mobile carrier NAT;
- household NAT.

Pure IP limits can block legitimate users.

### Proxy Headers

If behind a load balancer/proxy, client IP may come from:

```text
X-Forwarded-For
Forwarded
CF-Connecting-IP
X-Real-IP
```

Only trust these headers from trusted proxies. Do not let arbitrary clients spoof their IP.

### Autoscaling

Per-node in-memory limits change when app servers scale up/down.

```text
10 nodes * 100 req/min each = 1000 req/min
20 nodes * 100 req/min each = 2000 req/min
```

If the intended limit is global, use shared state or explicit per-node allocation.

## Observability

Track:

- allowed request count;
- rejected request count;
- rejection reason/policy;
- key type: IP/user/API key/tenant;
- hot keys;
- Redis/rate-limit latency;
- fail-open/fail-closed events;
- top limited endpoints;
- false-positive support cases.

Rate limits are product/security controls, not just code. They need dashboards and operational feedback.

## Interview Sentence

> I would design rate limiting by first choosing the identity and scope of the limit: IP, user, API key, tenant, endpoint, or a combination. For algorithms, fixed windows are simple but bursty, sliding logs are accurate but expensive, sliding counters are a good approximation, and token buckets are a practical default because they allow bursts while enforcing an average rate. In a horizontally scaled API, rate-limit state usually needs to live in a shared store like Redis, at the gateway, or be deliberately approximate per node. The implementation must update counters atomically, return `429 Too Many Requests` with retry guidance, and include observability. For security-sensitive flows like login, I would layer limits by IP and account identifier and avoid account-lockout designs that attackers can abuse for denial-of-service.

## Follow-Up Angles

- How would you implement a token bucket in Redis?
- How do API rate limits differ from monthly quotas?
- How would you rate limit login attempts without locking out legitimate users?
- How do distributed rate limits work across many app servers?
- What should happen if the Redis rate limiter is down?
- How do you rate limit multi-tenant SaaS workloads fairly?
