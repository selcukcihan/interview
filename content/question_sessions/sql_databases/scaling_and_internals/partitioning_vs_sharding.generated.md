# Partitioning vs Sharding


## Question

What is the difference between partitioning and sharding?

## Clue

Both techniques divide a large dataset into smaller pieces. The practical distinction is usually **where those pieces live and who manages them**.

## Partitioning

Partitioning commonly means splitting one logical table into smaller physical tables while keeping them inside one database system.

```text
orders
  orders_2024
  orders_2025
  orders_2026
```

The application still queries `orders`. The database examines the query and accesses only the relevant partitions when possible, which is called **partition pruning**.

For example:

```sql
SELECT *
FROM orders
WHERE created_at >= '2026-06-01';
```

If `orders` is partitioned by month, the database may scan only the June 2026 partition.

Common partitioning strategies include:

- range partitioning, such as rows grouped by date;
- list partitioning, such as rows grouped by region;
- hash partitioning, such as hashing `customer_id` across partitions.

Partitioning helps with query pruning, index size, maintenance, archiving, and deleting old data. However, if all partitions remain on one database server, they still share that server's CPU, memory, storage, and I/O limits.

## Sharding

Sharding distributes data across multiple independent database servers or database clusters.

```text
customer_id hash
  shard 1 -> database server A
  shard 2 -> database server B
  shard 3 -> database server C
```

Each shard owns only part of the dataset. This can increase total storage and write capacity because work is spread across multiple machines.

The system must determine which shard owns a row. That may be handled by:

- the application;
- a routing or proxy layer;
- a database system with built-in distributed sharding.

Sharding introduces distributed-systems problems: choosing and changing shard keys, rebalancing data, hot shards, cross-shard queries, distributed transactions, global uniqueness, backups, and failure handling.

## Concrete Example

Suppose an `orders` table contains ten billion rows.

With partitioning:

```text
one PostgreSQL cluster
  orders_europe
  orders_americas
  orders_asia
```

The table is easier to manage and some queries scan less data, but one cluster remains the main capacity boundary.

With sharding:

```text
PostgreSQL cluster A -> European customers
PostgreSQL cluster B -> American customers
PostgreSQL cluster C -> Asian customers
```

Capacity is distributed, but a report covering every region must query and combine results from all three shards.

## Important Terminology Caveat

The words are not universally exclusive. Sharding is often described as **horizontal partitioning across machines**. Some products also call distributed pieces partitions. In an interview, define what you mean rather than relying only on the labels.

## Interview Sentence

> Partitioning divides a logical table into smaller physical pieces, often within one database cluster, so the database can prune data and manage large tables more efficiently. Sharding distributes those pieces across independent database servers to scale beyond one machine. Sharding therefore provides a larger capacity boundary but introduces routing, rebalancing, cross-shard query, transaction, and operational complexity. In practice, sharding is a distributed form of horizontal partitioning, so I would clarify the terminology used by the particular database.

## Follow-Up Angles

- How do you choose a partition or shard key?
- Why do hot shards occur?
- How is data rebalanced when adding shards?
- Why are cross-shard joins and transactions difficult?
- How do partitioning and replication solve different problems?

## Follow-Up: Why Can Partitioning Substitute For Upper Index Levels?

PostgreSQL's documentation says partitioning can improve performance when heavily accessed rows live in one partition or a small number of partitions, because partitioning can effectively substitute for the upper tree levels of indexes.

The intuition is this: a large B-tree index is a tree. To find rows, PostgreSQL walks from the top of the tree down to leaf pages.

```text
huge orders index

root page
  branch pages
    more branch pages
      leaf pages for 2024 rows
      leaf pages for 2025 rows
      leaf pages for 2026 rows
```

If the table is not partitioned, one big index may cover all rows. Even if today's traffic mostly reads 2026 orders, the index structure still belongs to the full table. The useful hot part of the index may be mixed into a much larger structure.

With partitioning by time, each partition can have its own smaller index:

```text
orders_2024 index
orders_2025 index
orders_2026 index
```

When a query contains a condition like:

```sql
WHERE created_at >= '2026-06-01'
  AND created_at <  '2026-07-01'
```

PostgreSQL can prune away unrelated partitions and only use the relevant partition/index. In effect, the partition-selection step says "go to the 2026-06 physical chunk" before the normal B-tree lookup begins.

That is what "substitutes for the upper tree levels" means. Instead of using the top levels of one enormous index to navigate toward the relevant area, PostgreSQL can use partition metadata to jump directly to a smaller child table and its smaller index.

This helps most when:

- queries include the partition key in the filter;
- most traffic hits recent or otherwise hot partitions;
- each partition's indexes are much smaller than the global table's indexes would be;
- hot partition indexes fit in memory;
- old/cold partitions are rarely touched.

For example, imagine an `events` table with 5 billion rows over five years, partitioned monthly. The application mostly queries events from the last seven days.

Without partitioning:

```text
one giant events table
one giant index on (created_at, user_id)
```

The active working set competes with years of older index/data pages.

With monthly partitioning:

```text
events_2026_06
  index on (created_at, user_id)

events_2026_05
  index on (created_at, user_id)

events_2021_01
  index on (created_at, user_id)
```

Most traffic repeatedly uses the current month's partition and its index. That smaller index is more likely to stay in memory, so reads avoid disk more often.

Partitioning is not automatically faster. It can be worse if queries do not filter by the partition key, because PostgreSQL may need to check many partitions. It can also add planning overhead, operational complexity, and constraints around unique indexes. The win comes from matching the partitioning strategy to the access pattern.

## Interview Sentence: Partitioning And Indexes

> Partitioning can speed up reads when the query filters by the partition key, because the database can prune unrelated partitions and search only the smaller indexes for the relevant partitions. That is why PostgreSQL says partitioning can substitute for upper B-tree index levels: partition metadata first routes the query to the right physical child table, then the database searches a much smaller index whose hot pages are more likely to fit in memory.

## Follow-Up: What Are Upper Tree Levels Of An Index?

Most ordinary PostgreSQL indexes are B-tree indexes. A B-tree is shaped like an upside-down tree:

```text
level 0:            root page
                 /      |      \

level 1:      branch   branch   branch
              pages    pages    pages
             /  |  \   / | \    / | \

level 2:    leaf pages containing pointers to table rows
```

The **upper tree levels** are the root page and branch/internal pages near the top of the index. They do not usually point directly to table rows. Instead, they guide the database toward the right lower-level page.

For example, imagine an index on `created_at`:

```text
root page
  created_at < 2024 -> go left
  created_at < 2025 -> go middle
  otherwise         -> go right
```

Then a branch page narrows it further:

```text
branch page for 2026
  Jan-Mar -> child page A
  Apr-Jun -> child page B
  Jul-Sep -> child page C
  Oct-Dec -> child page D
```

Finally, the database reaches leaf pages, where the actual index entries live:

```text
leaf page
  2026-06-20 -> row pointer
  2026-06-21 -> row pointer
  2026-06-22 -> row pointer
```

So when PostgreSQL says partitioning can substitute for upper index levels, it means partition pruning can do some of the broad navigation work that the root and branch pages would otherwise do.

Without partitioning:

```text
search one giant index
  root says: go toward 2026
  branch says: go toward June
  leaf says: here are matching rows
```

With monthly partitioning:

```text
partition pruning says: use events_2026_06
search much smaller events_2026_06 index
  leaf says: here are matching rows
```

The partitioning scheme has already answered the high-level question: "which broad chunk of data can contain this row?" That is why the per-partition index can be smaller and shallower, and why its hot pages are more likely to stay in memory.

## Follow-Up: What Is Partitioning Using Inheritance?

PostgreSQL has a general feature called **table inheritance**. A child table can inherit columns and constraints from a parent table.

Example:

```sql
CREATE TABLE measurements (
  city_id int NOT NULL,
  logdate date NOT NULL,
  peaktemp int,
  unitsales int
);

CREATE TABLE measurements_2026_06 (
  CHECK (logdate >= DATE '2026-06-01' AND logdate < DATE '2026-07-01')
) INHERITS (measurements);

CREATE TABLE measurements_2026_07 (
  CHECK (logdate >= DATE '2026-07-01' AND logdate < DATE '2026-08-01')
) INHERITS (measurements);
```

Now `measurements_2026_06` and `measurements_2026_07` are real tables, but they are also children of `measurements`.

If you query the parent:

```sql
SELECT *
FROM measurements
WHERE logdate >= DATE '2026-06-10'
  AND logdate <  DATE '2026-06-11';
```

PostgreSQL can include rows from the child tables too. With the right `CHECK` constraints, the planner can sometimes exclude children whose constraints prove they cannot contain matching rows. This older mechanism is called **constraint exclusion**.

So inheritance-based partitioning means:

```text
parent table: measurements
  child table: measurements_2026_06
  child table: measurements_2026_07
  child table: measurements_2026_08
```

The parent gives you a single logical table to query. The children physically hold different slices of the data.

Before PostgreSQL 10, this was the main way people implemented partitioning in PostgreSQL. You manually created child tables, added constraints, created indexes on children, and often wrote triggers or rules to route inserts into the right child table.

In modern PostgreSQL, declarative partitioning is usually preferred:

```sql
CREATE TABLE measurements (
  city_id int NOT NULL,
  logdate date NOT NULL,
  peaktemp int,
  unitsales int
) PARTITION BY RANGE (logdate);

CREATE TABLE measurements_2026_06
PARTITION OF measurements
FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
```

This is still implemented using inheritance-like relationships internally, but PostgreSQL understands that the children are formal partitions. That gives better syntax, less manual routing, better partition pruning, and fewer sharp edges.

Why use inheritance-based partitioning today?

- You need flexibility not supported by declarative partitioning.
- Child tables need extra columns not present in the parent.
- A child table needs to inherit from multiple parents.
- You need a custom partitioning scheme beyond built-in range, list, or hash partitioning.
- You are maintaining an older PostgreSQL schema created before declarative partitioning existed.

Why not use it for normal partitioning?

- It is more manual.
- Insert routing may need triggers or application logic.
- Indexes are managed more separately.
- Query pruning depends on constraints and planner behavior.
- Declarative partitioning is the normal choice for range/list/hash partitioned tables.

## Interview Sentence: Inheritance Partitioning

> PostgreSQL inheritance partitioning is the older/manual way to partition a table by creating child tables that inherit from a parent table, adding `CHECK` constraints that define each child's slice, and relying on the planner to exclude irrelevant children. It solved the problem of representing one logical table as many physical tables before declarative partitioning existed. Today I would usually use declarative partitioning, unless I needed inheritance-specific flexibility such as child tables with extra columns, multiple inheritance, or a custom partitioning scheme.
