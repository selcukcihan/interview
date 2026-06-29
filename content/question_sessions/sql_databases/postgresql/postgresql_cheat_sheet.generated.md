# PostgreSQL Cheat Sheet


## Core Mental Model

```text
client
  -> connection/backend process
  -> transaction
  -> table/index pages in shared buffers
  -> WAL for durability
  -> commit record flushed
  -> dirty data pages flushed later
  -> replicas/CDC consume WAL
```

PostgreSQL is both:

- a SQL database engine that exposes transactions, tables, indexes, constraints, and query planning;
- a storage engine that manages pages, shared buffers, WAL, checkpoints, MVCC, vacuum, and replication.

## Transactions

```sql
BEGIN;

UPDATE accounts
SET balance = balance - 100
WHERE id = 1;

COMMIT;
```

Useful commands:

```sql
BEGIN;
COMMIT;
ROLLBACK;
SAVEPOINT before_risky_step;
ROLLBACK TO SAVEPOINT before_risky_step;
```

Key ideas:

- A transaction groups statements into one atomic unit.
- `COMMIT` makes changes durable and visible according to isolation rules.
- `ROLLBACK` discards uncommitted changes.
- PostgreSQL uses MVCC, so updates usually create new row versions rather than overwriting rows in place.

## Commit Internals

At commit time, PostgreSQL does **not** need to flush every changed table/index page to its final data file.

The critical durable step is:

```text
flush WAL through the commit record
```

After `COMMIT` returns:

```text
WAL durable through commit:       yes
transaction marked committed:     yes
new row version visible:          yes, subject to MVCC
dirty table/index pages flushed:  maybe not yet
replica replayed change:          maybe not yet
old row version vacuumed:         usually later
```

Normal reads do not read WAL. They read table/index pages through shared buffers.

```text
read path:
  shared buffers first
  data files if page is not cached
  MVCC visibility checks
```

If PostgreSQL crashes before dirty pages are flushed, startup recovery replays WAL to reconstruct committed changes.

## WAL

WAL means **write-ahead log**.

Rule:

```text
write the log record before relying on the changed data page
```

WAL is used for:

- crash recovery;
- transaction durability;
- physical replication;
- logical decoding;
- point-in-time recovery;
- WAL archiving.

WAL is not normally used to answer `SELECT` queries.

Useful concepts:

- **LSN**: log sequence number, a position in the WAL stream.
- **WAL segment**: WAL is stored in segment files under `pg_wal`.
- **checkpoint**: point where enough dirty pages are flushed that recovery can start from a newer WAL position.
- **full page writes**: after a checkpoint, the first modification to a page can log the whole page to protect against torn writes.

Useful SQL:

```sql
SELECT pg_current_wal_lsn();
SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0');
SELECT * FROM pg_stat_wal;
SELECT * FROM pg_stat_bgwriter;
SELECT * FROM pg_stat_checkpointer;
```

## Checkpoints

Checkpoint job:

```text
flush dirty table/index pages
write checkpoint record to WAL
allow crash recovery to start from a newer point
allow older WAL to be recycled/removed when safe
```

Important settings:

```text
checkpoint_timeout             time-based checkpoint interval
max_wal_size                   major WAL-size checkpoint trigger, not a hard cap
min_wal_size                   WAL kept around for reuse
checkpoint_completion_target   spreads checkpoint writes over time
checkpoint_warning             logs warning for too-frequent checkpoints
```

Rules of thumb:

- Frequent checkpoints can increase I/O and WAL volume.
- `max_wal_size` too small often causes checkpoint warnings.
- `checkpoint_completion_target` smooths checkpoint I/O.
- `max_wal_size` is not a hard disk limit; replication slots and archiving can retain more WAL.

## MVCC

MVCC means **multi-version concurrency control**.

An update is conceptually:

```text
old row version remains for transactions that can still see it
new row version is created for future visibility
```

Why it matters:

- readers do not usually block writers;
- writers do not usually block readers;
- old row versions need cleanup later;
- long-running transactions can prevent cleanup;
- table/index bloat can appear if vacuum cannot keep up.

Useful SQL:

```sql
SELECT txid_current();

SELECT pid, xact_start, state, query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start;
```

## Vacuum And Analyze

`VACUUM` cleans up dead row versions.

`ANALYZE` updates planner statistics.

```sql
VACUUM table_name;
ANALYZE table_name;
VACUUM ANALYZE table_name;
VACUUM VERBOSE table_name;
```

Important distinction:

```text
VACUUM:
  reclaims/reuses dead tuples
  helps control bloat
  advances cleanup

ANALYZE:
  samples table data
  updates statistics
  helps planner estimate row counts
```

Useful monitoring:

```sql
SELECT relname, n_dead_tup, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;
```

## Query Planning

Basic:

```sql
EXPLAIN SELECT ...;
EXPLAIN ANALYZE SELECT ...;
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
```

Meaning:

```text
EXPLAIN:
  planned behavior, does not run query

EXPLAIN ANALYZE:
  runs query and shows actual timing/rows

BUFFERS:
  shows shared/local/temp buffer activity
```

Read plans by checking:

- scan type: `Seq Scan`, `Index Scan`, `Index Only Scan`, bitmap scans;
- join type: nested loop, hash join, merge join;
- estimated rows vs actual rows;
- `loops`;
- sort/hash spill to temp;
- buffer hits vs reads;
- planning time vs execution time.

Safety:

```sql
BEGIN;
EXPLAIN ANALYZE DELETE FROM orders WHERE ...;
ROLLBACK;
```

`EXPLAIN ANALYZE` executes writes.

## Indexes

Common index commands:

```sql
CREATE INDEX idx_orders_customer_id ON orders (customer_id);

CREATE INDEX idx_orders_customer_created
ON orders (customer_id, created_at DESC);

CREATE UNIQUE INDEX idx_users_email ON users (email);

CREATE INDEX CONCURRENTLY idx_orders_status ON orders (status);

DROP INDEX CONCURRENTLY idx_orders_status;

REINDEX INDEX idx_orders_customer_id;
```

Rules of thumb:

- Indexes speed reads but slow writes.
- Composite index order matters.
- Indexes help most when predicates are selective or support ordering/joining.
- `CREATE INDEX CONCURRENTLY` avoids blocking writes for long periods, but takes longer and cannot run inside a transaction block.

## Locks

Useful lock inspection:

```sql
SELECT pid, locktype, relation::regclass, mode, granted
FROM pg_locks
ORDER BY granted, pid;
```

Blocking query:

```sql
SELECT
  blocked.pid AS blocked_pid,
  blocked.query AS blocked_query,
  blocker.pid AS blocker_pid,
  blocker.query AS blocker_query
FROM pg_stat_activity blocked
JOIN pg_locks blocked_locks
  ON blocked_locks.pid = blocked.pid
JOIN pg_locks blocker_locks
  ON blocker_locks.locktype = blocked_locks.locktype
 AND blocker_locks.database IS NOT DISTINCT FROM blocked_locks.database
 AND blocker_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
 AND blocker_locks.page IS NOT DISTINCT FROM blocked_locks.page
 AND blocker_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
 AND blocker_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
 AND blocker_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
 AND blocker_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
 AND blocker_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
 AND blocker_locks.pid <> blocked_locks.pid
JOIN pg_stat_activity blocker
  ON blocker.pid = blocker_locks.pid
WHERE NOT blocked_locks.granted
  AND blocker_locks.granted;
```

## Replication

Physical streaming replication:

```text
primary writes WAL
walsender streams WAL
standby walreceiver receives WAL
standby replays WAL
```

Logical replication:

```text
WAL is decoded into table-level INSERT/UPDATE/DELETE events
publication controls what is sent
subscription consumes and applies changes
```

Important terms:

- **primary**: accepts writes;
- **standby/replica**: replays changes;
- **hot standby**: replica serving read-only queries;
- **replication lag**: replica is behind primary;
- **replication slot**: retains WAL until consumer confirms progress;
- **promotion**: standby becomes primary;
- **split brain**: two nodes both accept writes as primary.

Useful replication SQL on primary:

```sql
SELECT
  pid,
  application_name,
  client_addr,
  state,
  sync_state,
  sent_lsn,
  write_lsn,
  flush_lsn,
  replay_lsn,
  write_lag,
  flush_lag,
  replay_lag
FROM pg_stat_replication;
```

Useful SQL on standby:

```sql
SELECT pg_is_in_recovery();
SELECT pg_last_wal_receive_lsn();
SELECT pg_last_wal_replay_lsn();
SELECT now() - pg_last_xact_replay_timestamp() AS replay_delay;
```

Replication slot monitoring:

```sql
SELECT
  slot_name,
  slot_type,
  active,
  restart_lsn,
  confirmed_flush_lsn,
  wal_status,
  safe_wal_size
FROM pg_replication_slots;
```

Create physical replication slot:

```sql
SELECT pg_create_physical_replication_slot('standby_1');
```

Create logical replication slot:

```sql
SELECT * FROM pg_create_logical_replication_slot('cdc_1', 'pgoutput');
```

Drop slot:

```sql
SELECT pg_drop_replication_slot('cdc_1');
```

Warning:

```text
inactive slot + retained WAL = possible disk fill
```

## Logical Replication

Publisher:

```sql
CREATE PUBLICATION app_pub FOR TABLE orders, customers;
```

Subscriber:

```sql
CREATE SUBSCRIPTION app_sub
CONNECTION 'host=primary.example.com dbname=app user=repl password=...'
PUBLICATION app_pub;
```

Replica identity:

```sql
ALTER TABLE orders REPLICA IDENTITY DEFAULT;
ALTER TABLE orders REPLICA IDENTITY FULL;
```

Why replica identity matters:

```text
UPDATE/DELETE events need to identify the old row
primary key is usually enough
REPLICA IDENTITY FULL is heavier but includes full old row identity
```

## Backup And Restore

Logical backup:

```bash
pg_dump -Fc -d appdb -f appdb.dump
pg_restore -d restored_db appdb.dump
```

Plain SQL backup:

```bash
pg_dump -d appdb -f appdb.sql
psql -d restored_db -f appdb.sql
```

Cluster-wide logical dump:

```bash
pg_dumpall > cluster.sql
psql -f cluster.sql postgres
```

Physical base backup:

```bash
pg_basebackup -D /var/lib/postgresql/standby -R -X stream -P
```

Rules of thumb:

- `pg_dump` backs up one database logically.
- `pg_dumpall` includes cluster-wide objects such as roles and tablespaces.
- `pg_basebackup` copies the physical database cluster and can seed replicas.
- `pg_restore` restores archive formats created by `pg_dump`.
- Always test restore, not just backup.

## Essential `pg_` Tools

### Client-Side And General Tools

These can usually run from a client machine.

| Tool | Use |
|---|---|
| `pg_dump` | logical backup of one database |
| `pg_dumpall` | logical dump of all databases and global objects |
| `pg_restore` | restore `pg_dump` archive formats |
| `pg_basebackup` | physical base backup of a running cluster |
| `pg_isready` | check server connection readiness |
| `pgbench` | benchmark PostgreSQL |
| `pg_receivewal` | stream WAL from a server |
| `pg_recvlogical` | control logical decoding streams |
| `pg_verifybackup` | verify a base backup |
| `pg_amcheck` | check corruption in databases |
| `pg_combinebackup` | combine incremental backup chain into a full backup |
| `pg_config` | show build/install configuration |
| `psql` | interactive SQL terminal |

Examples:

```bash
pg_isready -h localhost -p 5432

pg_dump -Fc -d appdb -f appdb.dump
pg_restore -l appdb.dump
pg_restore -d appdb appdb.dump

pg_basebackup -D ./basebackup -X stream -P

pg_receivewal -D ./wal_archive -h primary.example.com -U repl

pgbench -i appdb
pgbench -c 20 -j 4 -T 60 appdb
```

### Server-Side Tools

These are intended for the database server host or data directory.

| Tool | Use |
|---|---|
| `pg_ctl` | start, stop, reload, promote, or control a server |
| `pg_controldata` | inspect control file and cluster state |
| `pg_waldump` | render WAL records in human-readable form |
| `pg_rewind` | resync a diverged old primary with new primary |
| `pg_resetwal` | reset WAL/control info, last resort only |
| `pg_archivecleanup` | clean old WAL archive files |
| `pg_checksums` | enable, disable, or check data checksums |
| `pg_test_fsync` | test WAL sync method performance |
| `pg_test_timing` | measure timing overhead |
| `pg_upgrade` | upgrade major PostgreSQL version |
| `pg_createsubscriber` | convert physical replica into logical replica setup |
| `initdb` | create a new database cluster |

Examples:

```bash
pg_ctl -D "$PGDATA" status
pg_ctl -D "$PGDATA" reload
pg_ctl -D "$PGDATA" stop -m fast
pg_ctl -D "$PGDATA" promote

pg_controldata "$PGDATA"

pg_waldump "$PGDATA/pg_wal/000000010000000000000001"

pg_test_fsync
pg_test_timing
```

Dangerous commands:

```text
pg_resetwal:
  last resort when server cannot start due to WAL/control-file corruption
  can cause data loss/inconsistency if misused

pg_rewind:
  useful after failover when an old primary diverged
  must be used with a correct understanding of timeline/history
```

## `psql` Essentials

Connect:

```bash
psql -h localhost -p 5432 -U app_user -d appdb
psql "$DATABASE_URL"
```

Run command:

```bash
psql -d appdb -c "SELECT now();"
```

Run file:

```bash
psql -d appdb -f migration.sql
```

Useful meta-commands:

```text
\l              list databases
\c dbname       connect to database
\dt             list tables
\d table_name   describe table
\di             list indexes
\dv             list views
\dn             list schemas
\df             list functions
\du             list roles
\x              expanded output
\timing         show query timing
\watch 1        rerun query every 1 second
\copy           client-side copy
\?              psql help
\h SELECT       SQL help for SELECT
```

Good debugging combo:

```sql
\x
\timing
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
```

## Connection And Activity Inspection

```sql
SELECT pid, usename, application_name, client_addr, state, wait_event_type, wait_event, query
FROM pg_stat_activity
ORDER BY pid;
```

Long-running queries:

```sql
SELECT pid, now() - query_start AS age, state, query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY age DESC;
```

Cancel query:

```sql
SELECT pg_cancel_backend(12345);
```

Terminate connection:

```sql
SELECT pg_terminate_backend(12345);
```

Use terminate carefully. It closes the backend connection and rolls back its active transaction.

## Size And Bloat-Oriented Inspection

Database sizes:

```sql
SELECT datname, pg_size_pretty(pg_database_size(datname))
FROM pg_database
ORDER BY pg_database_size(datname) DESC;
```

Table sizes:

```sql
SELECT
  relname,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS table_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```

Index sizes:

```sql
SELECT
  indexrelname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;
```

## Roles And Permissions

```sql
CREATE ROLE app_user LOGIN PASSWORD '...';
CREATE DATABASE appdb OWNER app_user;

GRANT CONNECT ON DATABASE appdb TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
```

Inspect:

```sql
\du
\dp
```

## Configuration Inspection

```sql
SHOW config_file;
SHOW hba_file;
SHOW data_directory;
SHOW shared_buffers;
SHOW wal_level;
SHOW max_wal_size;
SHOW synchronous_commit;
```

Changed settings:

```sql
SELECT name, setting, unit, source
FROM pg_settings
WHERE source <> 'default'
ORDER BY name;
```

Reload config:

```sql
SELECT pg_reload_conf();
```

Some settings require restart:

```sql
SELECT name, setting, pending_restart
FROM pg_settings
WHERE pending_restart;
```

## Common Reliability Settings To Know

```text
fsync:
  should normally be on; controls whether PostgreSQL asks OS to flush data durably

synchronous_commit:
  controls when commits wait for WAL flush/local/remote guarantees

full_page_writes:
  protects against torn pages; normally on

wal_level:
  minimal/replica/logical level of WAL detail

max_wal_senders:
  max concurrent WAL sender processes for replication

max_replication_slots:
  max replication slots

hot_standby:
  allows read-only queries on standby
```

## Common Failure Modes

| Symptom | First Places To Look |
|---|---|
| Slow commits | WAL fsync time, storage latency, synchronous replication, checkpoints |
| Replica stale | `pg_stat_replication`, replay lag, standby long queries, WAL receive/replay |
| `pg_wal` growing | replication slots, archive failures, standby lag, high WAL generation |
| Bad query plan | `EXPLAIN ANALYZE`, stale stats, missing index, wrong estimates |
| Table bloat | autovacuum, long transactions, update/delete rate |
| Locks/timeouts | `pg_locks`, `pg_stat_activity`, blocking sessions |
| Cannot connect | `pg_isready`, `pg_hba.conf`, max connections, network/firewall |
| Disk full | relation sizes, `pg_wal`, logs, temp files, replication slots |

## Interview One-Liners

- PostgreSQL commits by making WAL durable through the commit record, not by flushing every data page.
- WAL is the source of crash recovery and replication, but normal reads use shared buffers/data files, not WAL.
- MVCC lets readers and writers coexist by keeping row versions, but vacuum must clean old versions later.
- Checkpoints trade normal workload I/O against crash recovery time.
- Replication lag is often an LSN gap between primary WAL progress and standby replay progress.
- Replication slots prevent missing WAL, but can fill disk if consumers stop.
- `EXPLAIN ANALYZE` shows actual runtime behavior; compare estimated rows with actual rows first.
- Read replicas scale reads, not primary write capacity.
- Logical decoding turns WAL into committed table-level changes for replication or CDC.

## Sources

- [PostgreSQL documentation: Client Applications](https://www.postgresql.org/docs/current/reference-client.html)
- [PostgreSQL documentation: Server Applications](https://www.postgresql.org/docs/current/reference-server.html)
- [PostgreSQL documentation: Write-Ahead Logging](https://www.postgresql.org/docs/current/wal-intro.html)
- [PostgreSQL documentation: WAL Configuration](https://www.postgresql.org/docs/current/wal-configuration.html)
- [PostgreSQL documentation: EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html)
- [PostgreSQL documentation: High Availability, Load Balancing, and Replication](https://www.postgresql.org/docs/current/high-availability.html)
