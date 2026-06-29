# Read-Heavy Product With High Database CPU


## Question

Your product page is backed by PostgreSQL and traffic grows 10x. The database CPU is high, but writes are modest. What do you do first?

## 2026-06-17

### Clue

The key idea: do not jump straight to sharding.

If writes are modest and CPU is high, first assume the database is doing too much repeated read work or inefficient read work.

The first moves are usually:

- measure the expensive queries,
- fix query plans and indexes,
- reduce repeated reads with caching,
- add read replicas if reads can tolerate replica lag,
- control connection pool pressure.

### Interview Shape

A strong answer starts with diagnosis:

```text
Is CPU high because of one bad query, many normal queries, too many connections, missing indexes, bad plans, or expensive sorting/joining?
```

Then it moves through low-risk scaling steps before high-complexity ones.

### Step 1: Find the Real Load

Look at:

- top queries by total CPU/time,
- query frequency,
- average and p95 latency,
- rows scanned vs rows returned,
- `EXPLAIN ANALYZE`,
- database CPU, I/O, locks, memory, connection count,
- cache hit ratio,
- app endpoint causing the load.

In PostgreSQL, useful tools include:

```text
pg_stat_statements
EXPLAIN ANALYZE
slow query logs
database metrics
```

The first question is:

```text
Are we doing too many reads, or are the reads inefficient?
```

### Step 2: Fix Query and Index Problems

If product page queries scan too much data:

- add or adjust indexes,
- use composite indexes in the right order,
- avoid unnecessary joins,
- fetch only needed columns,
- avoid N+1 queries,
- precompute expensive aggregates,
- use keyset pagination where relevant.

Example:

```sql
SELECT *
FROM products
WHERE category_id = 10
ORDER BY created_at DESC
LIMIT 50;
```

Likely index:

```sql
CREATE INDEX ON products (category_id, created_at DESC);
```

But the index should follow actual query shape, not guesswork.

### Step 3: Cache Repeated Reads

Product pages are often cacheable.

Possible cache layers:

- CDN cache for public product page HTML/assets,
- application cache for product data,
- Redis/Memcached for hot product objects,
- materialized view/precomputed table for expensive derived data.

If 80% of product page reads can be served from cache:

```text
database read load drops to 20%
```

This can be more effective than adding replicas.

Key caveat:

```text
Cache invalidation must match product freshness requirements.
```

### Step 4: Add Read Replicas

If reads still dominate and can tolerate slightly stale data:

```text
primary handles writes
replicas handle read queries
```

Example:

```text
write/update product -> primary
read product page -> replica
```

Tradeoffs:

- replication lag can show stale data,
- read-after-write behavior can break,
- failover becomes more complex,
- app must route reads/writes correctly,
- replicas do not help write bottlenecks.

For user-sensitive read-after-write flows, route to primary or use consistency-aware logic.

### Step 5: Control Connection Pools

Adding app servers can accidentally overload the database.

Example:

```text
40 app servers * 50 DB connections = 2,000 DB connections
```

That can hurt PostgreSQL even before queries are individually bad.

Use:

- sane per-app pool sizes,
- PgBouncer if appropriate,
- backpressure at the app layer,
- timeouts,
- max concurrency per endpoint/job.

### Step 6: Consider Data Layout Changes

If the table is huge or access patterns are naturally separable:

- partition large tables,
- archive cold data,
- denormalize read models,
- use materialized views,
- separate OLTP from analytics.

Partitioning can help with:

- pruning irrelevant data,
- managing large tables,
- retention/drop old partitions,
- reducing index sizes per partition.

But partitioning is not a universal CPU fix.

### Step 7: Sharding Is Later

Sharding is usually later because it adds major complexity:

- choosing shard key,
- cross-shard queries,
- resharding,
- distributed transactions,
- operational overhead,
- hot shard risk.

For a read-heavy product with modest writes, sharding is rarely the first answer.

### Interview Sentence

> I would not jump straight to sharding. Since writes are modest and database CPU is high, I would first identify the top read queries with metrics and `EXPLAIN ANALYZE`, fix bad query plans and missing indexes, eliminate N+1 patterns, and cache repeated product reads. If read load still dominates and the product can tolerate some staleness, I would add read replicas and route appropriate reads there, while protecting read-after-write paths. I would also control app connection pools so scaling app servers does not overload PostgreSQL. Only after query, cache, replica, and data-layout options are insufficient would I consider sharding.

### Follow-Up Angles

- High CPU does not automatically mean "need more database servers"; it may mean bad query plans.
- Read replicas scale reads but introduce replication lag.
- Caching can reduce database work more than replicas if the same product pages are repeatedly read.
- Connection pool sizing matters as app servers scale out.
- Sharding is powerful but operationally expensive and should have a clear bottleneck-driven reason.

### Follow-Up: Expanding Step 2 Query and Index Fixes

Step 2 was:

- add or adjust indexes,
- use composite indexes in the right order,
- avoid unnecessary joins,
- fetch only needed columns,
- avoid N+1 queries,
- precompute expensive aggregates,
- use keyset pagination where relevant.

#### Add or Adjust Indexes

An index lets the database find relevant rows without scanning the whole table.

Bad shape:

```sql
SELECT *
FROM products
WHERE slug = 'iphone-15-pro';
```

If `products.slug` has no index, PostgreSQL may scan many rows.

Better:

```sql
CREATE UNIQUE INDEX products_slug_idx ON products (slug);
```

Then the database can quickly seek to the row.

Interview clue:

> An index is a read shortcut, but every write must also maintain that shortcut.

So do not add random indexes. Add indexes that match real high-traffic query patterns.

#### Use Composite Indexes in the Right Order

A composite index covers multiple columns:

```sql
CREATE INDEX ON products (category_id, created_at DESC);
```

This fits:

```sql
SELECT id, name, price
FROM products
WHERE category_id = 10
ORDER BY created_at DESC
LIMIT 50;
```

Why order matters:

```text
(category_id, created_at)
```

means the index is first grouped by `category_id`, then ordered by `created_at` inside each category.

Good for:

```sql
WHERE category_id = ?
ORDER BY created_at DESC
```

Not equally good for:

```sql
WHERE created_at > ?
```

without `category_id`.

Interview clue:

> Composite index order should follow the query's filtering and ordering pattern, not just the list of columns involved.

Common heuristic:

```text
equality filters first,
then range/order columns,
then optional covering columns
```

But always verify with `EXPLAIN ANALYZE`.

#### Avoid Unnecessary Joins

Joins are not bad. Unnecessary joins are bad.

Example product page:

```sql
SELECT p.*, c.*, b.*, s.*
FROM products p
JOIN categories c ON c.id = p.category_id
JOIN brands b ON b.id = p.brand_id
JOIN suppliers s ON s.id = p.supplier_id
WHERE p.id = 123;
```

If the page only needs product name, price, category name, and brand name, joining supplier data may be waste.

Better:

```sql
SELECT p.id, p.name, p.price, c.name AS category_name, b.name AS brand_name
FROM products p
JOIN categories c ON c.id = p.category_id
JOIN brands b ON b.id = p.brand_id
WHERE p.id = 123;
```

Or for very hot reads, denormalize a read model:

```text
product_page_view
  product_id
  product_name
  price
  category_name
  brand_name
```

Interview clue:

> Joins are fine when they express needed relationships. They become a scaling problem when every hot read repeatedly reconstructs the same expensive view.

#### Fetch Only Needed Columns

This is especially important when rows have large fields.

Bad:

```sql
SELECT *
FROM products
WHERE category_id = 10
LIMIT 50;
```

Maybe `products` includes:

```text
description_html
search_document
large_json_metadata
internal_notes
```

Fetching all of that wastes:

- disk/page reads,
- memory,
- CPU,
- network bandwidth,
- JSON/object serialization time in the app.

Better:

```sql
SELECT id, name, price, thumbnail_url
FROM products
WHERE category_id = 10
LIMIT 50;
```

Interview clue:

> `SELECT *` makes the database, network, and app carry data the endpoint may not need.

#### Avoid N+1 Queries

N+1 means:

```text
1 query to fetch N products
then N more queries to fetch related data for each product
```

Bad pattern:

```text
SELECT * FROM products WHERE category_id = 10 LIMIT 50;

then for each product:
  SELECT * FROM reviews WHERE product_id = ?;
```

For 50 products:

```text
1 + 50 = 51 queries
```

Better:

```sql
SELECT *
FROM reviews
WHERE product_id IN (...50 product ids...);
```

Or use a join/aggregation if appropriate.

Interview clue:

> N+1 is death by round trips. Each individual query may be fast, but the endpoint becomes slow and the database sees huge query volume.

#### Precompute Expensive Aggregates

Some values are expensive to calculate on every page view.

Example:

```sql
SELECT AVG(rating), COUNT(*)
FROM reviews
WHERE product_id = 123;
```

If this runs on every product page view, hot products repeatedly pay the same cost.

Better options:

- maintain `products.review_count`,
- maintain `products.average_rating`,
- use a materialized view,
- update aggregates asynchronously from events,
- cache aggregate result.

Example read model:

```text
product_rating_summary
  product_id
  review_count
  average_rating
  updated_at
```

Interview clue:

> If many requests repeatedly compute the same aggregate, make it a write-time or async computation instead of a read-time computation.

Tradeoff:

```text
faster reads,
more complex writes,
possible staleness
```

#### Use Keyset Pagination Where Relevant

Offset pagination gets slower as the offset grows.

Bad at deep pages:

```sql
SELECT id, name
FROM products
WHERE category_id = 10
ORDER BY created_at DESC
OFFSET 100000
LIMIT 50;
```

The database may still need to walk/sort through many rows before returning 50.

Keyset pagination uses the last seen value:

```sql
SELECT id, name, created_at
FROM products
WHERE category_id = 10
  AND created_at < '2026-06-17T10:00:00Z'
ORDER BY created_at DESC
LIMIT 50;
```

With index:

```sql
CREATE INDEX ON products (category_id, created_at DESC);
```

Interview clue:

> Offset pagination says "skip this many rows." Keyset pagination says "continue from this known position."

Keyset is better for feeds, timelines, product listings, and infinite scroll. Offset may still be acceptable for small admin tables or when arbitrary page numbers matter.

#### Summary Sentence

> In a read-heavy scaling interview, I would say: before adding replicas or sharding, I would use query stats and `EXPLAIN ANALYZE` to find expensive reads, then make sure indexes match the actual filters and ordering, remove N+1 patterns and unnecessary joins, fetch only required columns, precompute repeated aggregates, and use keyset pagination for deep listings. These fixes reduce the amount of work the database does per request.
