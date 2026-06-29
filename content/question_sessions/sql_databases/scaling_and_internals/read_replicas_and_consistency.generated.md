# Read Replicas and Consistency


## Question

How do read replicas work, and what consistency tradeoffs do they introduce?

## Clue

A read replica contains a copy of the primary database's data. Writes go to the primary, while some reads are sent to replicas to reduce read load on the primary.

```text
                         -> read replica A -> reads
application -> primary -|-> read replica B -> reads
                writes   -> read replica C -> reads
```

## How Replication Works

The primary records changes in an ordered replication log, such as PostgreSQL's write-ahead log or MySQL's binary log.

```text
1. Primary commits UPDATE account ...
2. Primary records the change in its log
3. Replica receives the log entry
4. Replica applies the change locally
```

The replica is normally read-only from the application's perspective. Allowing independent writes to both databases would require conflict detection or coordination and is a different replication architecture.

## The Consistency Tradeoff

Replication is commonly asynchronous:

```text
primary commit succeeds
    <replication delay>
replica applies commit
```

During that delay, the replica returns old data. This is **replication lag** and produces eventual consistency for replica reads.

Example:

```text
1. User changes their name on the primary.
2. Application redirects to the profile page.
3. Profile read goes to a replica that has not applied the update.
4. User sees the old name.
```

This violates **read-your-writes consistency** even though the write succeeded.

## Common Application Strategies

- Send strongly consistent or critical reads to the primary.
- After a write, temporarily keep that user's reads on the primary.
- Track a replication position and use a replica only after it has caught up to that position.
- Accept stale data for feeds, analytics, search, and other tolerant endpoints.
- Stop routing to replicas whose lag exceeds a threshold.

## What Read Replicas Do and Do Not Scale

Read replicas can increase aggregate read capacity:

```text
one primary + four replicas -> reads distributed across five machines
```

They do not directly increase the primary's write capacity. Every replica must eventually process the primary's writes, and adding replicas can add replication and operational overhead.

Replicas can also support failover, reporting, backups, or geographically closer reads, but those uses have their own lag and recovery considerations.

## Synchronous Replication

With synchronous replication, the primary waits for acknowledgement from one or more replicas before confirming the commit. This can reduce data-loss risk and provide stronger guarantees, but increases write latency and may reduce availability if required replicas are unreachable.

It does not automatically mean every possible replica is current when queried. The exact guarantee depends on which replicas acknowledge commits and how reads are routed.

## Interview Sentence

> A read replica replays changes from the primary's replication log and serves reads from its own copy of the data. This scales read-heavy workloads, but asynchronous replication means replicas can lag behind the primary, so users may observe stale data or fail to read their own recent writes. I would route consistency-sensitive reads to the primary, use primary stickiness or replication-position checks after writes, monitor lag, and use replicas only for workloads whose consistency requirements they can satisfy. Read replicas scale reads; they do not solve primary write capacity.

## Follow-Up Angles

- What causes replication lag?
- How can lag break application behavior?
- How do synchronous and asynchronous replication differ?
- How does failover promote a replica safely?
- How does a load balancer or application choose a replica?
