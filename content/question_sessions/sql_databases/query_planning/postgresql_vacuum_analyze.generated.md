# PostgreSQL VACUUM and ANALYZE


## Question

What do `VACUUM` and `ANALYZE` do in PostgreSQL, when should you run them, and what are the operational tradeoffs?

## Short Answer

`ANALYZE` updates planner statistics.

`VACUUM` cleans up dead row versions created by PostgreSQL's MVCC model.

`VACUUM ANALYZE` does both: it reclaims reusable space inside the table and refreshes statistics so the planner can make better row-count estimates.

In normal production systems, autovacuum should usually handle both. Manual runs are useful after large data loads, large updates/deletes, or when query plans look wrong because statistics are stale.

## ANALYZE

```sql
ANALYZE orders;
```

`ANALYZE` samples the table and records statistics used by the query planner.

The planner uses these statistics to estimate:

- how many rows a table has;
- how many distinct values a column has;
- which values are most common;
- how values are distributed;
- how many `NULL` values exist;
- whether an index is likely to be useful.

For example:

```sql
SELECT *
FROM orders
WHERE status = 'paid'
  AND created_at >= now() - interval '30 days';
```

PostgreSQL needs statistics to estimate how many rows match `status = 'paid'` and how many rows are recent. Those estimates influence whether it chooses a sequential scan, index scan, bitmap scan, hash join, nested loop, or merge join.

`ANALYZE` does not rewrite the table, remove dead tuples, or create indexes. It only refreshes planner statistics.

## Does ANALYZE Put Load on the Database?

Yes, but usually modest load.

`ANALYZE` samples table pages, computes statistics, and updates catalog metadata. It is much lighter than commands like `VACUUM FULL`, `CREATE INDEX`, or a large reporting query.

However, on very large tables or busy systems, it can still consume I/O and CPU. The impact can be higher when statistics targets are large or many columns need analysis.

## When to Run ANALYZE

Run manual `ANALYZE` after:

- bulk `INSERT`;
- `COPY` imports;
- large `UPDATE` or `DELETE`;
- creating and populating a new table;
- major data distribution changes;
- changing statistics settings;
- seeing bad row estimates in `EXPLAIN ANALYZE`.

Example:

```sql
COPY orders FROM '/tmp/orders.csv' CSV HEADER;
ANALYZE orders;
```

Without this, PostgreSQL may still plan as if the table were empty or had its old data distribution.

## VACUUM

```sql
VACUUM orders;
```

PostgreSQL uses MVCC. When a row is updated or deleted, the old row version usually remains in the table for a while because concurrent transactions may still need to see it.

Those old row versions are dead tuples.

`VACUUM` marks dead tuples as reusable once no active transaction needs them.

Regular `VACUUM`:

- cleans dead row versions;
- frees space inside the table for reuse;
- cleans dead index entries;
- updates the visibility map;
- helps index-only scans avoid heap reads;
- prevents transaction ID wraparound problems.

Regular `VACUUM` usually does not shrink the table file on disk. It makes space inside the file reusable.

## VACUUM ANALYZE

```sql
VACUUM ANALYZE orders;
```

This combines cleanup and planner-statistics refresh.

Use it after large data changes when both are useful:

- many dead tuples may exist;
- planner statistics may be stale.

## VACUUM FULL

```sql
VACUUM FULL orders;
```

`VACUUM FULL` rewrites the table into a compact new copy and returns unused disk space to the operating system.

It is much heavier than regular `VACUUM`:

- takes an exclusive lock;
- blocks normal reads and writes;
- rewrites the table;
- needs extra disk space while running;
- can take a long time.

Use it rarely, usually after a massive delete when returning disk space to the OS is worth the downtime or maintenance window.

## Autovacuum

PostgreSQL normally runs vacuum and analyze automatically through autovacuum.

Best practice:

- keep autovacuum enabled;
- tune it when needed;
- manually run `ANALYZE` or `VACUUM ANALYZE` after large planned data changes;
- do not rely on frequent manual vacuuming as the main maintenance strategy.

Auto-analyze is triggered roughly by:

```text
autovacuum_analyze_threshold
+ autovacuum_analyze_scale_factor * table_size
```

The common defaults are:

```text
autovacuum_analyze_threshold = 50
autovacuum_analyze_scale_factor = 0.10
```

For very large tables, 10% may be too much change before refreshing statistics. In that case, lower the scale factor for that table:

```sql
ALTER TABLE orders SET (
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 1000
);
```

## How VACUUM Affects Query Plans

`VACUUM` affects performance in two main ways.

First, it removes dead tuples from the work future scans need to do. A table with many dead row versions can be more expensive to scan.

Second, it updates the visibility map. This matters for index-only scans.

An index-only scan can avoid reading heap pages only when PostgreSQL knows those pages are all-visible:

```text
Index Only Scan
  Heap Fetches: 0
```

If the visibility map is not up to date, PostgreSQL may still need heap fetches even when the index contains all requested columns.

## Common Commands

```sql
ANALYZE orders;
```

Refresh planner statistics for one table.

```sql
ANALYZE;
```

Refresh planner statistics for the database.

```sql
VACUUM orders;
```

Clean dead tuples for one table.

```sql
VACUUM ANALYZE orders;
```

Clean dead tuples and refresh statistics.

```sql
VACUUM (VERBOSE, ANALYZE) orders;
```

Clean, analyze, and print detailed progress/results.

```sql
VACUUM FULL orders;
```

Rewrite and compact the table. Heavy and blocking.

## Interview Follow-Ups

### What is the difference between `VACUUM` and `ANALYZE`?

`VACUUM` cleans dead tuples and makes space reusable. `ANALYZE` updates planner statistics. They solve different problems.

### Does `VACUUM` return disk space to the operating system?

Regular `VACUUM` usually does not. It frees space inside the table file for reuse. `VACUUM FULL` rewrites the table and can return disk space to the OS, but it is heavy and blocking.

### Why can stale statistics cause bad query plans?

The planner chooses plans based on estimated row counts. If PostgreSQL thinks a filter returns 10 rows but it actually returns 1 million rows, it may choose a nested loop or index strategy that performs badly.

### Is a manual `ANALYZE` safe to run?

Usually yes. It takes light locks and does not block normal reads and writes like heavy DDL. But it still consumes I/O and CPU, so on busy production systems it should be used deliberately.

### When should you tune autovacuum?

Tune autovacuum when tables accumulate dead tuples too quickly, query plans suffer from stale statistics, or very large tables change significantly before the default auto-analyze threshold is reached.

## Local Practice

For the practice schema:

```sql
VACUUM (VERBOSE, ANALYZE) query_plan_practice.orders;
```

Then inspect the table stats:

```sql
SELECT
  relname,
  n_live_tup,
  n_dead_tup,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname = 'query_plan_practice'
ORDER BY relname;
```
