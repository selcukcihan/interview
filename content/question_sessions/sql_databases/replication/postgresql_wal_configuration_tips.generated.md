# PostgreSQL WAL Configuration: Distilled Notes


## Question

What are the useful PostgreSQL WAL configuration settings to understand, and how should we think about tuning them?

## Short Answer

Most WAL configuration is about balancing four things:

```text
commit latency
checkpoint I/O spikes
crash recovery time
disk usage in pg_wal
```

The most interview-relevant settings are:

- `checkpoint_timeout`
- `max_wal_size`
- `min_wal_size`
- `checkpoint_completion_target`
- `checkpoint_warning`
- `wal_buffers`
- `full_page_writes`
- `wal_keep_size`
- `archive_timeout`
- `commit_delay`
- `commit_siblings`
- `wal_sync_method`
- `track_wal_io_timing`

Do not memorize all defaults. Understand what each setting is trying to trade off.

## Checkpoints

A checkpoint is a point where PostgreSQL guarantees that heap and index data files contain all changes before a certain WAL position.

At checkpoint time:

```text
dirty table/index pages are flushed to disk
checkpoint record is written to WAL
future crash recovery can start from this checkpoint's redo position
older WAL can often be recycled/removed
```

Why checkpoints matter:

```text
more frequent checkpoints:
  faster crash recovery
  more frequent dirty-page flushing
  more WAL volume with full_page_writes
  more I/O overhead

less frequent checkpoints:
  smoother normal workload if configured well
  more WAL kept
  potentially longer crash recovery
```

## `checkpoint_timeout`

`checkpoint_timeout` controls the time-based checkpoint interval.

Conceptually:

```text
start a checkpoint every checkpoint_timeout seconds
unless no WAL was written since the previous checkpoint
```

Lower value:

- shorter crash recovery window;
- more frequent checkpoints;
- more dirty-page write pressure;
- more full-page image WAL after each checkpoint.

Higher value:

- fewer checkpoints;
- usually less checkpoint overhead;
- more WAL retained;
- potentially longer crash recovery.

Interview mental model:

> Do not make checkpoints very frequent just because it sounds safer. Frequent checkpoints can increase I/O and WAL volume.

## `max_wal_size`

`max_wal_size` is a major trigger for checkpoints. If PostgreSQL is about to exceed it, a checkpoint is started.

It is not a hard disk usage limit. WAL can exceed it due to:

- WAL archiving delays;
- replication slots;
- standby/recovery limitations;
- bursts of WAL generation;
- restartpoint behavior on standbys.

Common symptom:

```text
LOG: checkpoints are occurring too frequently
HINT: Consider increasing max_wal_size.
```

If this appears often, `max_wal_size` is probably too small for the workload.

Practical tip:

> For write-heavy or bulk-load workloads, increasing `max_wal_size` often reduces checkpoint frequency and smooths performance.

## `min_wal_size`

`min_wal_size` controls how much WAL PostgreSQL keeps recycled for future use even when the system becomes idle.

Higher value:

- keeps more WAL segment files ready for reuse;
- can reduce file creation/removal churn;
- uses more baseline disk space.

Lower value:

- uses less idle disk space;
- may require more WAL segment creation during future bursts.

This is usually less urgent than `max_wal_size`.

## `checkpoint_completion_target`

Checkpoints can be expensive because they write many dirty buffers. PostgreSQL spreads checkpoint writes across part of the checkpoint interval.

`checkpoint_completion_target` controls how much of the interval PostgreSQL tries to use.

Example:

```text
checkpoint_timeout = 5 min
checkpoint_completion_target = 0.9

PostgreSQL tries to spread checkpoint writes over about 4.5 min
```

Higher value:

- smoother checkpoint I/O;
- less bursty latency;
- checkpoint work lasts longer;
- more WAL may need to be retained for recovery.

Lower value:

- checkpoint finishes sooner;
- more intense I/O during checkpoint;
- quiet period after checkpoint;
- usually not recommended for latency-sensitive workloads.

The docs say the default `0.9` spreads I/O as much as possible without trying to use the full interval.

Practical tip:

> For most systems, keep `checkpoint_completion_target` near the default. If checkpoints cause latency spikes, first look at `max_wal_size` and whether checkpoints are too frequent.

## `checkpoint_warning`

`checkpoint_warning` is a diagnostic setting.

If checkpoints happen closer together than this threshold, PostgreSQL logs a warning suggesting that checkpoint settings may need adjustment.

This is useful because frequent checkpoints are easy to miss until they show up as write latency problems.

Practical tip:

> If warning messages appear frequently during normal workload, consider increasing `max_wal_size`. Occasional warnings during large `COPY` or bulk loads may be expected.

## `full_page_writes`

`full_page_writes` protects against torn pages.

After each checkpoint, the first time a data page is modified, PostgreSQL logs the entire page image in WAL, not just the small change.

Why:

```text
crash happens while a data page is half-written
page on disk is torn/corrupt
WAL has full page image
recovery can restore the page safely
```

Tradeoff:

- safer against torn pages;
- more WAL volume, especially after checkpoints;
- frequent checkpoints increase full-page-write overhead.

Practical tip:

> Treat `full_page_writes=on` as the normal safe setting. If WAL volume is high, usually tune checkpoint frequency and storage rather than disabling this casually.

## `wal_buffers`

`wal_buffers` is memory used for WAL records before they are written out.

PostgreSQL internally inserts WAL records into WAL buffers. If there is no space, a backend doing ordinary row changes may have to write WAL buffers itself while holding low-level locks.

That is undesirable because WAL insertion happens on the critical path of data modifications.

Higher `wal_buffers` can help when:

- the system generates WAL very quickly;
- there are many concurrent writers;
- latency spikes appear after checkpoints;
- `full_page_writes` creates bursts of larger WAL records.

Practical tip:

> If write-heavy workload shows WAL buffer pressure, increasing `wal_buffers` can smooth response times. It is not a substitute for fixing checkpoint or storage bottlenecks.

## `wal_keep_size`

`wal_keep_size` keeps a minimum amount of recent WAL available in `pg_wal` for standbys.

This can help a standby reconnect after a short disconnection without needing a fresh base backup.

But it is not the same as a replication slot.

```text
wal_keep_size:
  keep at least this much recent WAL
  if standby falls behind more than that, WAL may still be gone

replication slot:
  retain WAL until consumer confirms progress
  safer for consumer
  can fill disk if consumer stops
```

Practical tip:

> Use `wal_keep_size` as a cushion for short standby outages. Use replication slots when you need stronger retention, but monitor disk usage and slot lag aggressively.

## WAL Archiving And `archive_timeout`

With WAL archiving, old WAL segments cannot be recycled or removed until archived.

If archiving falls behind or `archive_command` repeatedly fails:

```text
pg_wal grows
disk fills
database is at risk
```

`archive_timeout` forces PostgreSQL to switch WAL files periodically so they can be archived even during low write volume.

Use case:

```text
you want to bound point-in-time-recovery data loss window
even when traffic is low and WAL segments fill slowly
```

Practical tip:

> Do not tune checkpoint settings to force archiving frequency. Use `archive_timeout` for archive frequency and recovery-point objectives.

## Replication Slots And WAL Growth

Replication slots can retain WAL independently of `max_wal_size`.

If a slot's consumer stops:

```text
primary keeps old WAL
pg_wal grows
disk can fill
```

This is one of the most important operational risks in PostgreSQL replication and CDC.

Practical tip:

> Monitor replication slot retained WAL and alert before disk is threatened. Slots are correctness tools, not fire-and-forget settings.

## Restartpoints On Standbys

On a standby or during archive recovery, PostgreSQL performs **restartpoints**, which are similar to checkpoints.

They allow recovery to avoid replaying from too far back.

Important difference:

```text
restartpoints can only happen at checkpoint records from the primary
```

So a standby may temporarily exceed `max_wal_size`, especially under heavy WAL generation, because it cannot always restartpoint exactly when it wants to.

Practical tip:

> Leave disk headroom on standbys too. `max_wal_size` is not a hard cap.

## `commit_delay` And `commit_siblings`

These settings relate to group commit.

Normally, committing transactions need WAL flushed to durable storage. Group commit lets multiple transactions share one expensive WAL flush.

`commit_delay` says:

```text
after one process becomes group commit leader,
wait briefly so other committers can join
then flush once for the group
```

`commit_siblings` controls when that delay is considered worthwhile, based on other active transactions.

Tradeoff:

```text
possible higher throughput
possible higher individual transaction latency
```

This can help when:

- many transactions commit concurrently;
- commit rate is limited by WAL flush latency;
- storage has noticeable fsync cost.

It can hurt when:

- workload has low concurrency;
- delay is too high;
- latency matters more than throughput.

Practical tip:

> Do not tune `commit_delay` blindly. Measure WAL flush cost with `pg_test_fsync` and test with representative concurrency.

## `wal_sync_method`

`wal_sync_method` controls how PostgreSQL asks the OS to force WAL to durable storage.

Examples vary by platform, such as:

- `fdatasync`
- `fsync`
- `fsync_writethrough`
- `open_sync`
- `open_datasync`

The docs say reliability should be equivalent among options except that `fsync_writethrough` may force disk-cache flushes where others do not, depending on platform.

Performance is platform-specific.

Practical tip:

> Use `pg_test_fsync` to compare options on the actual storage platform. Do not assume the fastest setting from another machine applies to yours.

## `track_wal_io_timing`

When enabled, PostgreSQL tracks WAL write and fsync timing in `pg_stat_io`.

This helps distinguish:

```text
WAL write time:
  moving WAL buffers to kernel/storage path

WAL fsync time:
  forcing WAL to durable storage
```

Practical tip:

> Enable or sample WAL I/O timing when investigating commit latency or WAL storage bottlenecks. Be aware that timing instrumentation can add overhead on some systems.

## `checkpoint_flush_after`

On Linux and POSIX platforms, `checkpoint_flush_after` can ask the OS to flush pages written by checkpoints after a certain amount of data.

Why it exists:

```text
without it:
  checkpoint writes pile up in OS page cache
  final fsync may stall badly

with it:
  OS starts flushing earlier
  final fsync stall may be reduced
```

But it can hurt some workloads, especially when the workload fits in OS page cache but not PostgreSQL shared buffers.

Practical tip:

> Treat this as an advanced latency-smoothing knob. Test it under the real workload.

## Practical Symptom-To-Setting Map

| Symptom | Likely Area To Inspect |
|---|---|
| Checkpoint warnings in logs | `max_wal_size`, bulk writes, checkpoint frequency |
| Periodic write latency spikes | checkpoint behavior, `checkpoint_completion_target`, storage I/O |
| Huge `pg_wal` directory | archiving failure, replication slots, standby lag, WAL summarization |
| Replica disconnected and cannot catch up | `wal_keep_size`, replication slots, base backup requirement |
| High commit latency | WAL fsync time, `wal_sync_method`, storage latency, group commit |
| WAL generation very bursty after checkpoints | `full_page_writes`, checkpoint frequency, `wal_buffers` |
| Standby exceeds expected WAL size | restartpoint limits, primary checkpoint timing, standby replay delay |
| CDC pipeline causes disk growth | logical replication slot retaining WAL |

## Safe Defaults Mental Model

For interview and operational reasoning:

```text
Do not disable fsync for durability.
Do not disable full_page_writes casually.
Do not assume max_wal_size is a hard disk cap.
Do not use checkpoint settings to control archiving frequency.
Do monitor pg_wal size, checkpoint frequency, slot lag, archiving, and WAL fsync time.
Do increase max_wal_size when checkpoints are too frequent under normal load.
Do leave disk headroom for WAL bursts, slots, archiving problems, and standby restartpoint behavior.
```

## Interview Sentence

> WAL configuration is mainly about controlling commit durability cost, checkpoint frequency, recovery time, and WAL disk usage. `checkpoint_timeout` and `max_wal_size` decide when checkpoints happen; frequent checkpoints reduce recovery work but increase dirty-page flushing and full-page-write WAL. `checkpoint_completion_target` spreads checkpoint I/O to avoid spikes. `wal_buffers` helps absorb high WAL generation. `wal_keep_size`, archiving, and replication slots affect how long WAL is retained, and slots can fill disk if consumers fall behind. For commit latency, inspect WAL fsync behavior, `wal_sync_method`, group commit settings, and `pg_stat_io` with `track_wal_io_timing`. The safest advice is to monitor first and avoid disabling durability settings casually.

## Sources

- [PostgreSQL documentation: WAL Configuration](https://www.postgresql.org/docs/current/wal-configuration.html)
- [PostgreSQL documentation: Write-Ahead Logging](https://www.postgresql.org/docs/current/wal-intro.html)
