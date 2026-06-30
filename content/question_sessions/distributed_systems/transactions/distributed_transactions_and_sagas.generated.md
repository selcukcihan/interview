# Distributed Transactions and Sagas

## Question

What are distributed transactions, why are they hard, and how does the saga pattern help?

## Short Answer

A distributed transaction tries to make one logical operation atomic across multiple independent systems.

Example:

```text
place order:
  create order row in Orders DB
  reserve inventory in Inventory DB
  charge card in Payments service
  create shipment in Shipping service
```

The application wants this to feel like:

```text
either everything succeeds
or nothing happens
```

That is easy inside one database transaction. It is hard across multiple databases/services because each system can fail independently, messages can be delayed, and one service may commit while another times out.

A **saga** breaks the workflow into local transactions plus compensating actions.

```text
do step 1
do step 2
do step 3
if step 3 fails, compensate step 2 and step 1
```

Sagas avoid holding one global lock/transaction across services, but they do not give the same simple atomicity as a single database transaction. They give **eventual consistency with explicit recovery logic**.

## Local Transaction vs Distributed Transaction

Single database transaction:

```sql
BEGIN;

UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;

COMMIT;
```

The database controls:

- locks;
- WAL;
- rollback;
- commit;
- isolation;
- crash recovery.

If commit succeeds, both changes are committed. If rollback happens, neither is.

Distributed version:

```text
Service A writes to DB A
Service B writes to DB B
Service C calls external payment provider
```

No single database controls all state. There is no one local transaction manager that can instantly roll everything back.

## Why Distributed Transactions Are Hard

Failure cases:

```text
Orders DB committed, Inventory DB timed out.
Payment provider charged card, Shipping service failed.
Coordinator crashed after telling one participant to commit.
Network partition makes a service unreachable.
Caller retries and duplicates the operation.
One participant is slow and holds locks for too long.
```

The hard part is uncertainty.

If a service times out, you may not know:

```text
did it fail before doing the operation?
did it commit but response was lost?
is it still processing?
will retry duplicate it?
```

That is why idempotency and durable state matter so much.

## Two-Phase Commit

Two-phase commit, or 2PC, is the classic distributed transaction protocol.

Participants:

```text
coordinator
participant A
participant B
participant C
```

Phase 1: prepare

```text
coordinator -> participants: can you commit?
participants write enough local state to promise they can commit later
participants reply yes/no
```

Phase 2: commit or abort

```text
if everyone says yes:
  coordinator tells everyone to commit
else:
  coordinator tells everyone to abort
```

The good part:

```text
all participants commit or all abort, if protocol completes correctly
```

The bad parts:

- participants may hold locks while waiting;
- coordinator failure can block participants;
- slow/unavailable participant hurts the whole transaction;
- harder to operate across heterogeneous services;
- not every external system supports prepare/commit;
- long-running business workflows do not fit well.

2PC is useful in some controlled environments, but many high-scale service architectures avoid it for normal business workflows.

## Saga Pattern

A saga is a sequence of local transactions.

Each step commits locally, then the saga moves forward.

If a later step fails, the system runs compensating actions.

Example:

```text
1. Create order as PENDING
2. Reserve inventory
3. Authorize payment
4. Confirm order
5. Start fulfillment
```

If payment fails:

```text
compensate inventory reservation
mark order as PAYMENT_FAILED
notify user
```

Important:

```text
compensation is not the same as rollback
```

Rollback erases uncommitted work inside a transaction.

Compensation is a new business action that semantically undoes or offsets an already-committed action.

Example:

```text
payment charge committed
cannot un-commit it
issue refund instead
```

## Concrete Order Example

Services:

```text
Orders service
Inventory service
Payments service
Email service
```

Happy path:

```text
1. Orders: create order PENDING
2. Inventory: reserve items
3. Payments: authorize card
4. Orders: mark CONFIRMED
5. Email: send confirmation
```

Failure at payment:

```text
1. Orders: create order PENDING              committed
2. Inventory: reserve items                  committed
3. Payments: authorize card                  failed
4. Inventory: release reservation            compensation
5. Orders: mark PAYMENT_FAILED               compensation/state transition
6. Email: send failure message               optional
```

The system was temporarily inconsistent:

```text
inventory reserved
order not confirmed
payment not authorized
```

That is acceptable if the business process knows how to complete or compensate it.

## Orchestration vs Choreography

### Orchestrated Saga

One central orchestrator tells services what to do.

```text
OrderSaga orchestrator
  -> create order
  -> reserve inventory
  -> authorize payment
  -> confirm order
```

Pros:

- workflow is explicit;
- easier to see current state;
- easier to handle timeouts and retries centrally;
- easier for complex workflows.

Cons:

- orchestrator can become a central dependency;
- more coupling to service commands;
- orchestrator must be reliable and durable.

### Choreographed Saga

Services react to events.

```text
OrderCreated event
  -> Inventory reserves items
InventoryReserved event
  -> Payments authorizes card
PaymentAuthorized event
  -> Orders confirms order
```

Pros:

- less central coordination;
- services are loosely coupled through events;
- natural for event-driven systems.

Cons:

- workflow is harder to understand globally;
- event chains can become implicit;
- debugging is harder;
- cyclic dependencies and duplicated reactions are risks.

Practical default:

```text
simple event flows: choreography can work
complex business workflows: orchestration is usually easier to reason about
```

## Idempotency Is Required

Distributed workflows retry.

So each step must tolerate duplicate commands/messages.

Example:

```http
POST /payments/authorize
Idempotency-Key: order_123_authorize_payment
```

If the caller retries after a timeout, the payment service should return the original result instead of charging twice.

Implementation idea:

```text
idempotency_key
operation_type
request_hash
status
result
created_at
```

The service stores the result of the first request and reuses it for retries with the same key.

## Transactional Outbox

A common problem:

```text
write database row
publish event to message broker
```

If the DB write succeeds but event publish fails, other services never hear about the change.

Transactional outbox solves this by writing the event into the same local database transaction as the business change.

```sql
BEGIN;

INSERT INTO orders (...) VALUES (...);

INSERT INTO outbox_events (event_type, payload)
VALUES ('OrderCreated', '{...}');

COMMIT;
```

Then a separate publisher reads `outbox_events` and publishes to the broker.

This gives:

```text
business row and event record commit atomically in one local DB
event delivery happens eventually
```

Consumers still need idempotency because events may be delivered more than once.

## Consistency Model

With a saga, the system often moves through intermediate states:

```text
PENDING
INVENTORY_RESERVED
PAYMENT_AUTHORIZED
CONFIRMED
FULFILLING
```

or failure states:

```text
PAYMENT_FAILED
INVENTORY_RELEASE_PENDING
CANCELLED
REFUND_PENDING
REFUNDED
```

This is not a bug. It is the model.

Instead of pretending the workflow is instant and atomic, the system exposes durable states and recovery paths.

## When To Use What

Use a single local transaction when:

- all required data is in one database;
- the operation is short;
- you need strong atomicity;
- the database can enforce invariants.

Consider 2PC when:

- participants support it;
- the environment is controlled;
- transactions are short;
- blocking is acceptable;
- strong atomicity matters more than availability/latency.

Use sagas when:

- workflow spans services/databases;
- operations are long-running;
- external systems are involved;
- exact rollback is impossible;
- eventual consistency is acceptable with compensation.

Avoid splitting data across services if every operation requires a distributed transaction. That often means the service boundary is wrong.

## Common Interview Pitfalls

### Saying Sagas Give ACID Across Services

They do not.

Sagas provide local ACID transactions plus eventual consistency and compensation.

### Treating Compensation As Perfect Rollback

Some actions cannot be truly undone.

```text
email sent
package shipped
card charged
external webhook called
```

You need business-specific correction actions.

### Ignoring Retries

Every step should be retryable and idempotent.

### Ignoring Observability

You need to know:

- saga ID;
- current state;
- failed step;
- retry count;
- compensation status;
- stuck workflows;
- correlation IDs across services.

## Interview Sentence

> A distributed transaction tries to make one logical operation atomic across multiple independent systems, but that is difficult because each participant can commit, fail, timeout, or become unreachable independently. Two-phase commit coordinates a prepare and commit phase, but it can block, hold locks, and requires participant support, so it is often avoided for long-running service workflows. A saga instead decomposes the workflow into local transactions with durable state transitions and compensating actions. It trades immediate global atomicity for eventual consistency, idempotent retries, explicit failure states, and business-level recovery.

## Follow-Up Angles

- How does two-phase commit work, and why can it block?
- What is the difference between saga orchestration and choreography?
- What is the transactional outbox pattern?
- Why is idempotency required in sagas?
- How do you design compensation for payment/order workflows?
- How do you monitor and recover stuck sagas?
- How do sagas relate to event sourcing and CQRS?
