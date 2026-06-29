# Logical Decoding Into Row-Level Events


## Question

How does logical decoding turn WAL into row-level events?

## Short Answer

PostgreSQL writes changes to the write-ahead log in an internal WAL format. **Logical decoding** reads that WAL stream and reconstructs committed table-level changes such as:

```text
BEGIN
INSERT public.orders id=123 customer_id=42 total=99.50
UPDATE public.orders id=123 total=109.50
DELETE public.orders id=123
COMMIT
```

An **output plugin** then formats those decoded changes for the consumer. The built-in logical replication plugin is `pgoutput`; other plugins can emit formats such as JSON.

## The Pipeline

```text
SQL write
  -> PostgreSQL changes table/index pages
  -> PostgreSQL writes WAL records
  -> logical replication slot remembers consumer position
  -> logical decoding reads WAL from that position
  -> output plugin converts internal changes into messages
  -> consumer receives row-level events
```

The important distinction:

```text
physical replication:
  "replay these low-level storage changes"

logical decoding:
  "tell me which rows changed in which tables"
```

## Concrete Example

Suppose the application runs:

```sql
BEGIN;

INSERT INTO orders (id, customer_id, total)
VALUES (123, 42, 99.50);

UPDATE orders
SET total = 109.50
WHERE id = 123;

COMMIT;
```

PostgreSQL records WAL for the transaction. A logical decoder can turn the committed transaction into a stream like:

```text
BEGIN lsn=...
table public.orders: INSERT id=123 customer_id=42 total=99.50
table public.orders: UPDATE id=123 total=109.50
COMMIT lsn=...
```

The exact output depends on the output plugin. `pgoutput` uses PostgreSQL's logical replication protocol. A JSON plugin could output JSON objects instead.

## Why WAL Contains Enough Information

WAL must contain enough information for PostgreSQL to recover and replay changes safely. For logical decoding, PostgreSQL can interpret WAL records together with system catalog metadata to identify:

- which table changed;
- which operation happened: `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`;
- which columns are present in the new row;
- which old row identity is needed for updates/deletes;
- transaction boundaries;
- commit order.

Logical decoding does not merely stream raw WAL bytes to the application. It decodes them into a logical change stream.

## Replication Slots

Logical decoding normally uses a **logical replication slot**.

The slot tracks the consumer's progress:

```text
consumer has safely received changes up to LSN 5000
primary must keep required WAL after LSN 5000
```

This prevents PostgreSQL from deleting WAL the consumer has not yet consumed.

That is necessary for correctness, but dangerous operationally:

```text
consumer stops
slot remains
PostgreSQL retains WAL
disk usage grows
database can run out of disk
```

## Output Plugins

An output plugin decides how decoded changes are represented.

Examples:

- `pgoutput`: built-in plugin used by PostgreSQL logical replication.
- `test_decoding`: simple example plugin useful for understanding output.
- `wal2json`: common external plugin that emits JSON.

The plugin receives decoded transaction changes and emits messages in its own format.

Conceptually:

```text
internal decoded change
  relation: public.orders
  operation: UPDATE
  new tuple: { id: 123, customer_id: 42, total: 109.50 }

output plugin
  -> protocol message, text, JSON, protobuf, etc.
```

## Replica Identity

For `UPDATE` and `DELETE`, the consumer often needs to know which old row changed.

PostgreSQL uses **replica identity** to decide what old-row information is available.

Common cases:

```sql
ALTER TABLE orders REPLICA IDENTITY DEFAULT;
```

Uses the primary key as the row identity.

```sql
ALTER TABLE orders REPLICA IDENTITY FULL;
```

Includes the full old row as identity information. This is heavier, but can be useful when there is no primary key or when downstream consumers need old values.

Why this matters:

```text
DELETE FROM orders WHERE id = 123;
```

A downstream consumer needs to know which row to delete. If the table has a primary key, the event can identify the row by `id=123`. Without a usable replica identity, logical decoding may not have enough old-row information for reliable downstream updates/deletes.

## Transaction Boundaries And Ordering

Logical decoding preserves transaction boundaries.

That means a consumer sees:

```text
BEGIN
change 1
change 2
change 3
COMMIT
```

not three unrelated changes.

This is important because downstream systems usually need to apply changes atomically or at least in commit order.

Logical decoding emits changes for committed transactions. Rolled-back transaction changes are not delivered as committed row events.

## Publications And Subscriptions

PostgreSQL logical replication builds on logical decoding.

In logical replication:

```sql
CREATE PUBLICATION app_pub FOR TABLE orders, customers;
```

defines what the publisher exposes.

```sql
CREATE SUBSCRIPTION app_sub
CONNECTION 'host=... dbname=...'
PUBLICATION app_pub;
```

defines what the subscriber consumes.

The publication controls table selection and, in newer PostgreSQL versions, can also support features such as column lists and row filters. Under the hood, WAL is decoded into logical table changes and sent to the subscriber.

## What Logical Decoding Is Used For

Common uses:

- logical replication between PostgreSQL databases;
- change data capture;
- feeding Kafka or another stream;
- search indexing;
- cache invalidation;
- audit/event pipelines;
- online migrations.

## Important Limitations

Logical decoding is not a magic application event log.

Important caveats:

- It sees database changes, not application intent.
- It may not include all old column values unless replica identity supports that.
- DDL/schema changes need separate handling.
- Consumers must track LSNs and handle retries/idempotency.
- Slow consumers can cause WAL retention through replication slots.
- Output format and filtering depend on the plugin and publication setup.

For example, logical decoding can tell you:

```text
orders.status changed from pending to paid
```

if enough old/new data is available.

It cannot automatically tell you:

```text
customer completed checkout from mobile promo campaign
```

unless that intent was represented in database writes.

## Interview Sentence

> Logical decoding reads PostgreSQL WAL through a logical replication slot and converts the internal WAL records into committed table-level changes. An output plugin, such as `pgoutput` or `wal2json`, formats those decoded changes into messages like inserts, updates, deletes, transaction boundaries, relation metadata, and LSN positions. For updates and deletes, PostgreSQL uses the table's replica identity, usually the primary key, to decide what old-row identity is available. This is useful for logical replication and CDC, but consumers must handle lag, retries, schema changes, idempotency, and WAL retention from slots.

## Follow-Up Angles

- What is the difference between logical decoding and logical replication?
- Why does replica identity matter for `UPDATE` and `DELETE`?
- How do replication slots retain WAL?
- How does a CDC consumer resume safely after crashing?
- Why are schema changes difficult for CDC pipelines?

## Sources

- [PostgreSQL documentation: Logical Decoding](https://www.postgresql.org/docs/current/logicaldecoding.html)
- [PostgreSQL documentation: Logical Decoding Concepts](https://www.postgresql.org/docs/current/logicaldecoding-explanation.html)
- [PostgreSQL documentation: Logical Replication](https://www.postgresql.org/docs/current/logical-replication.html)
