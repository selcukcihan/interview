# Two-Phase Commit and Blocking

## Question

How does two-phase commit work, and why can it block?

## Short Answer

Two-phase commit, or 2PC, is a protocol for making multiple systems commit or abort one distributed transaction together.

It has:

```text
coordinator
participants
```

The coordinator asks each participant if it is ready to commit. If all participants say yes, the coordinator tells everyone to commit. If anyone says no, the coordinator tells everyone to abort.

The problem is that once a participant votes **yes**, it has promised it can commit later. It may need to hold locks and keep prepared transaction state while waiting for the coordinator's final decision. If the coordinator crashes or becomes unreachable at that moment, the participant can be stuck in an uncertain prepared state.

That is why 2PC is called a **blocking protocol**.

## The Setup

Suppose a transfer touches two databases:

```text
Accounts DB A:
  subtract $100 from Alice

Accounts DB B:
  add $100 to Bob
```

The system wants:

```text
both commit
or both abort
```

Participants:

```text
coordinator: transaction manager
participant A: DB A
participant B: DB B
```

## Phase 1: Prepare / Vote

The coordinator asks:

```text
Can you commit this transaction if I later tell you to?
```

Participant A does local work:

```text
BEGIN;
UPDATE alice_account SET balance = balance - 100;
PREPARE TRANSACTION 'tx123';
```

Participant B does local work:

```text
BEGIN;
UPDATE bob_account SET balance = balance + 100;
PREPARE TRANSACTION 'tx123';
```

When a participant prepares successfully, it writes enough durable state so that even after a crash it can later either commit or abort the prepared transaction.

Then it replies:

```text
YES, prepared
```

or:

```text
NO, cannot commit
```

## Phase 2: Commit Or Abort

If all participants vote yes:

```text
coordinator writes decision: COMMIT
coordinator tells A: COMMIT
coordinator tells B: COMMIT
participants commit prepared transaction
```

If any participant votes no:

```text
coordinator writes decision: ABORT
coordinator tells all prepared participants: ABORT
participants rollback prepared transaction
```

## Happy Path Timeline

```text
coordinator -> A: prepare tx123
coordinator -> B: prepare tx123

A -> coordinator: yes
B -> coordinator: yes

coordinator durably records: commit tx123

coordinator -> A: commit tx123
coordinator -> B: commit tx123

A commits
B commits
```

This gives atomicity across participants if the protocol completes.

## Why The Prepared State Matters

Prepared means:

```text
I am ready to commit.
I have durably recorded the transaction.
I will not unilaterally forget it.
I am waiting for the coordinator's final decision.
```

The participant cannot safely decide on its own after voting yes.

If it commits but the coordinator decides abort, atomicity breaks.

If it aborts but the coordinator decides commit, atomicity breaks.

So it must wait.

## Where Blocking Happens

The dangerous window is:

```text
participants voted yes
coordinator has not delivered final decision
```

Example:

```text
1. A prepares and votes yes.
2. B prepares and votes yes.
3. Coordinator records commit decision.
4. Coordinator crashes before telling A and B.
5. A and B are prepared but do not know the final decision.
```

Now A and B cannot safely choose commit or abort alone.

They may hold:

- row locks;
- transaction state;
- database resources;
- application-level reservations.

Until they learn the decision, they are blocked.

## What If The Coordinator Recovers?

If the coordinator recovers and its decision log is intact, it can continue:

```text
read decision: commit tx123
tell participants: commit tx123
```

So coordinator crash is not automatically fatal.

The problem is availability while the decision is unavailable.

If the coordinator is down for 10 minutes, participants may be blocked for 10 minutes.

If the coordinator's decision is lost, manual recovery may be needed.

## What If A Participant Crashes?

If a participant crashes after preparing, it must remember the prepared transaction after restart.

That is why prepare must be durable.

After restart:

```text
participant sees prepared tx123
participant asks coordinator for final decision
participant commits or aborts accordingly
```

Prepared transactions are intentionally persistent.

## PostgreSQL Example

PostgreSQL supports prepared transactions for 2PC-style coordination.

Participant transaction:

```sql
BEGIN;

UPDATE accounts
SET balance = balance - 100
WHERE id = 1;

PREPARE TRANSACTION 'tx123';
```

Later:

```sql
COMMIT PREPARED 'tx123';
```

or:

```sql
ROLLBACK PREPARED 'tx123';
```

Inspect prepared transactions:

```sql
SELECT *
FROM pg_prepared_xacts;
```

Important operational warning:

```text
prepared transactions left unresolved can hold locks and prevent cleanup
```

In PostgreSQL, `max_prepared_transactions` controls whether prepared transactions are available. Many systems leave this disabled unless they explicitly need it.

## Why 2PC Can Hurt Performance

2PC adds overhead:

```text
extra network round trips
durable prepare records
durable coordinator decision log
locks held across services
blocked participants during uncertainty
hard recovery paths
```

It also turns a multi-service operation into a tightly coupled availability problem:

```text
if any required participant is slow/unavailable,
the whole distributed transaction is slow/unavailable
```

That is often a poor fit for long-running business workflows.

## Why 2PC Is Different From A Saga

2PC:

```text
tries to commit all participants atomically
participants wait in prepared state
rollback is protocol-level abort before final commit
```

Saga:

```text
commits each local step independently
uses compensating actions after failures
allows intermediate visible states
```

So:

```text
2PC optimizes for atomic commit
saga optimizes for availability and workflow recovery
```

Neither is universally better. The right choice depends on the invariant and failure model.

## When 2PC Might Be Reasonable

2PC can make sense when:

- all participants support it well;
- transactions are short-lived;
- participant set is small and controlled;
- blocking is acceptable;
- strong atomicity is required;
- operations do not involve external irreversible side effects.

Examples:

- a tightly controlled enterprise system;
- multiple XA-capable resources;
- two databases under the same operational ownership;
- short cross-resource updates where inconsistency is unacceptable.

## When To Avoid 2PC

Avoid or be cautious when:

- workflow is long-running;
- external services are involved;
- payment, email, shipping, or third-party APIs are involved;
- participants may be unreliable or independently deployed;
- user-facing availability matters more than immediate atomicity;
- holding locks for a long time would hurt the system;
- recovery would require manual intervention.

## Interview Sentence

> Two-phase commit has a coordinator and participants. In phase one, the coordinator asks each participant to prepare; a participant that votes yes durably records that it can commit and must wait for the final decision. In phase two, the coordinator tells everyone to commit if all voted yes, otherwise abort. It can block because after voting yes, participants cannot safely decide commit or abort on their own. If the coordinator crashes or the final decision is unavailable, prepared participants may hold locks and resources until the coordinator recovers or an operator resolves the transaction.

## Follow-Up Angles

- What is three-phase commit, and why is it rarely used?
- How do XA transactions relate to 2PC?
- How does PostgreSQL implement prepared transactions?
- What operational problems can unresolved prepared transactions cause?
- Why do microservices often prefer sagas over 2PC?
- Can consensus protocols solve the coordinator failure problem?
