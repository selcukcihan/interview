# PostgreSQL EXPLAIN


## Question

What does `EXPLAIN` tell you in PostgreSQL, and how do you use it to debug query performance?

## Short Answer

`EXPLAIN` shows the execution plan PostgreSQL intends to use for a query.

It answers questions like:

- Which table is read first?
- Is PostgreSQL doing a sequential scan or index scan?
- Which join algorithm is used?
- How many rows does PostgreSQL expect at each step?
- Where does PostgreSQL think the expensive part of the query is?

Plain `EXPLAIN` estimates. It does not run the query.

`EXPLAIN ANALYZE` runs the query and shows what actually happened.

## Basic Example

```sql
EXPLAIN
SELECT *
FROM orders
WHERE customer_id = 42
ORDER BY created_at DESC
LIMIT 20;
```

Possible output:

```text
Limit  (cost=0.43..12.80 rows=20 width=96)
  ->  Index Scan Backward using orders_customer_created_idx on orders
        (cost=0.43..6180.50 rows=9991 width=96)
        Index Cond: (customer_id = 42)
```

This means PostgreSQL plans to use an index, scan it backward to satisfy `ORDER BY created_at DESC`, and stop after 20 rows.

That is usually good. PostgreSQL can avoid reading all matching rows and sorting them.

## EXPLAIN vs EXPLAIN ANALYZE

`EXPLAIN`:

```sql
EXPLAIN SELECT * FROM orders WHERE customer_id = 42;
```

Shows the planned execution strategy. It is safe for `SELECT`, `INSERT`, `UPDATE`, and `DELETE` because the statement is not actually executed.

`EXPLAIN ANALYZE`:

```sql
EXPLAIN ANALYZE
SELECT * FROM orders WHERE customer_id = 42;
```

Runs the query and reports actual timing and row counts.

Be careful:

```sql
EXPLAIN ANALYZE
DELETE FROM orders WHERE customer_id = 42;
```

This actually deletes rows. If you need to inspect a write query safely, use a transaction and roll it back:

```sql
BEGIN;

EXPLAIN ANALYZE
DELETE FROM orders WHERE customer_id = 42;

ROLLBACK;
```

## The Most Important Fields

### Node Type

Each line is a plan node.

Common node types:

- `Seq Scan`: read the table directly, page by page.
- `Index Scan`: use an index to find rows, then read table rows.
- `Index Only Scan`: use the index without reading the table, when possible.
- `Bitmap Index Scan`: use an index to build a bitmap of matching row locations.
- `Bitmap Heap Scan`: read table pages using that bitmap.
- `Nested Loop`: for each row from one side, look up matching rows on the other side.
- `Hash Join`: build a hash table from one input, probe it with the other.
- `Merge Join`: join two sorted inputs.
- `Sort`: sort rows.
- `Aggregate`: compute aggregates such as `count`, `sum`, or `group by`.
- `Limit`: stop after enough rows are produced.

### Cost

Example:

```text
Seq Scan on orders  (cost=0.00..18293.00 rows=100000 width=96)
```

`cost=0.00..18293.00` means:

- startup cost: estimated work before the first row can be returned;
- total cost: estimated work to produce all rows from that node.

Cost is not milliseconds. It is PostgreSQL's internal unit for comparing plans. A lower-cost plan is usually chosen.

### Rows

```text
rows=100000
```

This is PostgreSQL's estimated number of rows produced by that node.

Bad row estimates are one of the most common reasons PostgreSQL picks a bad plan.

For example, if PostgreSQL estimates 10 rows but actually gets 10 million rows, it may choose a nested loop that becomes terrible at runtime.

### Width

```text
width=96
```

Estimated average row size in bytes.

Wider rows mean more memory, I/O, and sort/hash cost.

## Reading EXPLAIN ANALYZE

Example:

```sql
EXPLAIN ANALYZE
SELECT *
FROM orders
WHERE customer_id = 42;
```

Possible output:

```text
Seq Scan on orders
  (cost=0.00..18293.00 rows=100 width=96)
  (actual time=0.040..842.300 rows=250000 loops=1)
  Filter: (customer_id = 42)
  Rows Removed by Filter: 4750000
Planning Time: 0.300 ms
Execution Time: 860.000 ms
```

Important parts:

- `actual time=0.040..842.300`: actual time to first row and last row.
- `actual rows=250000`: actual rows produced.
- `loops=1`: how many times this node ran.
- `Rows Removed by Filter`: rows read but rejected.
- `Planning Time`: time spent planning.
- `Execution Time`: time spent executing.

Here PostgreSQL scanned the whole `orders` table and filtered out 4.75 million rows. If this query is common, an index on `customer_id` may help.

## Blocking Nodes and Actual Time

Do not judge a parent node's cost by subtracting its first-row time from its last-row time.

Example:

```text
Sort  (actual time=220.499..227.231 rows=68010)
  Sort Method: external merge  Disk: 3536kB
  ->  Hash Join  (actual time=36.972..141.337 rows=68010)
```

It is tempting to say the sort took only:

```text
227.231 - 220.499 = 6.732 ms
```

That is misleading for blocking nodes.

A `Sort` cannot emit its first row until it has consumed all child rows and sorted them. The child hash join finished at about `141.337 ms`, while the sort emitted its first row at about `220.499 ms`.

The blocking gap is closer to:

```text
220.499 - 141.337 = 79.162 ms
```

That gap is the useful clue. It shows time spent after the child finished producing rows but before the parent could return its first row.

Common blocking or partly blocking nodes include:

- `Sort`;
- `HashAggregate`;
- `GroupAggregate` when it requires sorted input;
- hash table build sides of `Hash Join`;
- `Materialize`;
- `Unique`;
- `Gather Merge`.

Streaming nodes can pass rows upward as they receive them. Blocking nodes must first consume enough input to produce output.

When reading `EXPLAIN ANALYZE`, compare:

- the child node's finish time;
- the parent node's first-row time;
- temp file usage such as `temp read` and `temp written`;
- details like `Sort Method: external merge`.

This gives a better sense of where time is spent than looking only at `actual time` inside one node.

## Estimated Rows vs Actual Rows

The most useful thing in `EXPLAIN ANALYZE` is comparing estimated rows with actual rows.

Example:

```text
Nested Loop  (cost=0.85..120.00 rows=10)
             (actual time=0.050..9000.000 rows=500000)
```

PostgreSQL expected 10 rows but got 500,000. That huge mismatch can cause a bad plan.

Possible causes:

- stale statistics;
- missing statistics for correlated columns;
- skewed data distribution;
- predicates that are hard to estimate;
- missing or misleading indexes.

Common first step:

```sql
ANALYZE orders;
```

or:

```sql
VACUUM ANALYZE orders;
```

## Sequential Scan Is Not Always Bad

A sequential scan can be correct.

For example:

```sql
SELECT *
FROM orders
WHERE status = 'completed';
```

If 80% of rows have `status = 'completed'`, using an index may be slower than scanning the table. The index would find many row pointers, then PostgreSQL would still need to read many table pages.

Indexes help most when they are selective or when they support ordering, joins, uniqueness, or index-only access.

## Common Debugging Pattern

Start with:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...
```

`BUFFERS` shows whether the query is mostly hitting memory or reading from disk/cache pages.

Then look for:

- big estimated-vs-actual row mismatches;
- sequential scans over large tables where the filter is selective;
- expensive sorts;
- nested loops running many times;
- large `Rows Removed by Filter`;
- missing indexes for filters, joins, or ordering;
- queries fetching too many columns or too many rows;
- partition pruning not happening when expected.

## Example: Missing Index

Query:

```sql
SELECT *
FROM orders
WHERE customer_id = 42
ORDER BY created_at DESC
LIMIT 20;
```

Bad plan:

```text
Limit
  ->  Sort
        Sort Key: created_at DESC
        ->  Seq Scan on orders
              Filter: (customer_id = 42)
              Rows Removed by Filter: 4990000
```

This means PostgreSQL reads many rows, filters them, sorts the result, and then keeps only 20.

Better index:

```sql
CREATE INDEX orders_customer_created_idx
ON orders (customer_id, created_at DESC);
```

Better plan:

```text
Limit
  ->  Index Scan using orders_customer_created_idx on orders
        Index Cond: (customer_id = 42)
```

Now PostgreSQL can jump to rows for that customer in the desired order and stop after 20.

## Interview Sentence

> `EXPLAIN` shows the query plan PostgreSQL intends to use: scans, joins, sorts, estimated row counts, and estimated costs. `EXPLAIN ANALYZE` actually runs the query and adds real timing and actual row counts. When debugging performance, I compare estimated rows to actual rows, look for expensive scans, joins, sorts, repeated loops, and missing indexes, and I often use `EXPLAIN (ANALYZE, BUFFERS)` to see whether the query is CPU, memory/cache, or I/O heavy.

## Source

- [PostgreSQL documentation: EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html)
- [PostgreSQL documentation: Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)

## Official Docs Summary: Reading EXPLAIN ANALYZE

The official PostgreSQL docs define `EXPLAIN` as a command that shows the execution plan generated by the planner for a statement. That plan tells you how PostgreSQL intends to scan tables and which join algorithms it will use.

The core mental model:

```text
EXPLAIN           -> planned behavior
EXPLAIN ANALYZE   -> planned behavior + actual runtime behavior
```

### The Shape Of The Output

A plan is a tree. The indented child nodes run underneath parent nodes.

Example:

```text
HashAggregate
  Group Key: foo
  ->  Index Scan using test_pkey on test
        Index Cond: ((id > 100) AND (id < 200))
```

Read this from the bottom up:

1. PostgreSQL scans rows from `test` using `test_pkey`.
2. Those rows flow into `HashAggregate`.
3. `HashAggregate` groups rows by `foo`.

### Cost

Example:

```text
cost=10.77..10.87
```

PostgreSQL shows two cost numbers:

- startup cost: estimated work before the first row can be returned;
- total cost: estimated work to return all rows from that plan node.

Cost is not wall-clock time. It is an internal planner unit used to compare possible plans.

For most full-result queries, total cost matters more. For queries that can stop early, such as `EXISTS` or `LIMIT`, startup cost can matter more because PostgreSQL may only need the first row.

### Estimated Rows And Width

Example:

```text
rows=99 width=8
```

`rows` is the planner's estimated number of rows produced by that node.

`width` is the estimated average size of each row in bytes.

These estimates affect plan choice. If row estimates are badly wrong, PostgreSQL can choose the wrong scan or join strategy.

### Actual Time, Actual Rows, Loops

With `ANALYZE`, PostgreSQL executes the statement and adds runtime statistics:

```text
actual time=0.009..0.025 rows=99 loops=1
```

This means:

- actual startup time: time until the first row from this node;
- actual total time: time until this node finished;
- actual rows: rows returned by this node;
- loops: how many times this node was executed.

If `loops` is greater than 1, be careful. The displayed actual time and rows are usually per loop for that node. To understand total work, multiply by loops.

Example:

```text
Index Scan ... (actual time=0.01..0.02 rows=1 loops=100000)
```

One loop is cheap, but 100,000 loops may be expensive. This often appears inside nested loops.

### Buffers

With `BUFFERS`, PostgreSQL shows block usage:

```text
Buffers: shared hit=4
```

Important terms:

- `shared`: regular table and index blocks;
- `local`: temporary table/index blocks;
- `temp`: temporary working data for operations like sorts and hashes;
- `hit`: block was already in cache, so no read was needed;
- `read`: block had to be read;
- `dirtied`: previously clean block was changed;
- `written`: dirty block was written out by this backend.

High `shared hit` can still mean lots of memory/cache work. High `read` suggests more physical or OS-cache I/O pressure. High `temp read/write` often points to sort/hash work spilling beyond memory.

### Planning Time And Execution Time

At the bottom you may see:

```text
Planning Time: 0.244 ms
Execution Time: 0.073 ms
```

Planning time is time spent choosing the plan.

Execution time is time spent running the statement.

For simple queries, planning can sometimes be a meaningful part of total time. For complex analytical queries, execution usually dominates.

### Important Safety Warning

`EXPLAIN ANALYZE` actually runs the statement.

For `SELECT`, PostgreSQL discards the result output, but it still does the work.

For writes, side effects happen:

```sql
EXPLAIN ANALYZE
DELETE FROM orders WHERE customer_id = 42;
```

This deletes rows.

To inspect a write safely:

```sql
BEGIN;
EXPLAIN ANALYZE DELETE FROM orders WHERE customer_id = 42;
ROLLBACK;
```

### Useful Options

Practical default:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...
```

Other useful options:

- `VERBOSE`: show extra plan details such as output columns and schema-qualified names.
- `COSTS false`: hide cost estimates for simpler visual output.
- `SETTINGS`: show planner-affecting settings that differ from defaults.
- `WAL`: for writes, show WAL records and bytes generated.
- `TIMING false`: reduce timing overhead when you only care about actual row counts.
- `SUMMARY`: include summary information such as planning and execution time.
- `MEMORY`: show memory used by the planning phase.
- `FORMAT JSON`: easier for tools to parse than text output.

### Practical Reading Order

When reading `EXPLAIN ANALYZE`, use this order:

1. Find the slow/highest-work part of the tree.
2. Compare estimated `rows` with actual `rows`.
3. Check `loops`; repeated cheap operations may be expensive in total.
4. Look at scan types: `Seq Scan`, `Index Scan`, `Index Only Scan`, bitmap scans.
5. Look at join types: nested loop, hash join, merge join.
6. Check for sort/hash spill using temp buffer reads/writes.
7. Look at `Buffers` to understand cache/I/O behavior.
8. Check whether planning time or execution time dominates.

The docs also point out that planner quality depends on table statistics. If the table changed substantially and autovacuum has not caught up, a manual `ANALYZE` can improve estimates.

### Important Caveat

`EXPLAIN ANALYZE` itself adds measurement overhead. A query under `EXPLAIN ANALYZE` can run slower than the same query normally, especially when many tiny plan-node executions require repeated timing calls.
