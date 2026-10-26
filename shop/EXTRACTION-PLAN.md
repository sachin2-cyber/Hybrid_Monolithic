# Extraction plan: notifications

## Which module, and why this one

Notifications. Of the four modules it has the fewest links to the others.

- Its only inbound dependency is one event, `order.placed`. Orders does not
  wait for it and gets no answer back from it.
- Its one table, `outbox`, is read only by `sent()`, which only the flow test
  and `src/app.ts` call. No other module reads it.
- It does slow, unreliable external work (sending email), so its load and
  failure profile is the most different from the rest.

Signal (step 14): a module whose load or deploy needs differ from the rest of
the system, with a boundary that is already clean. Notifications fits: its
boundary is one event, and its work is external I/O.

## What it owns and who reads it

- Owns: the `outbox` table (`"outbox"`, via `src/modules/notifications/repo.ts`).
- Read by: `sent()` in `src/modules/notifications/index.ts`, used by
  `test/flow.test.ts` and `src/app.ts`. Nothing in orders, inventory or
  payments reads it.
- Written by: only the `order.placed` subscriber in
  `src/modules/notifications/index.ts`.

## What breaks when each call becomes a network call

There is one inbound call today, and it is already asynchronous in spirit.

1. `order.placed` moves from the in-process bus to a broker. Orders now sends
   a network message instead of calling a function. Failure modes:
   - Broker unreachable at publish time: orders must not fail the order, so
     the event is written to orders' own outbox table in the same transaction
     as the order, and a relay sends it later. Without this, an order can be
     saved and its confirmation lost.
   - Publish times out but the broker did receive it: the relay sends it
     again. Notifications must ignore a second `order.placed` for an
     `orderId` it has already sent for (idempotency key = `orderId`).
2. `sent()` becomes an HTTP call. Only tests and the app use it. Break: the
   flow test's "a confirmation goes out" check needs a fake or a real
   notifications instance. Change the test, not the behaviour.

### The ten-minute outage

Notifications is down for ten minutes. What happens:

- Orders: `placeOrder` still returns `ok: true`. The order is placed, stock is
  reserved and the charge is recorded. Nothing in orders waits on notifications.
- Broker: holds every `order.placed` for the ten minutes. Nothing is lost,
  provided the broker is durable and not memory-only.
- Notifications on recovery: consumes the backlog. Each confirmation arrives
  about ten minutes late. Duplicates are dropped by `orderId`.
- After N failed attempts for one message, it moves to a dead-letter queue and
  an alert fires. A person then decides whether to resend.

The customer gets a late email, not a failed order. That is the answer this
plan gives to "what happens to the confirmation".

## The five steps (check these against slide 15)

1. Make the seam explicit. Done in task 2: other modules reach notifications
   only through `index.ts`, and the only inbound path is the event.
   Check: `node tools/check-boundaries.ts` is clean.
2. Put a port in front of the bus. Orders publishes through an interface, so
   the in-process bus can be swapped for a broker without touching orders.
   Check: the event-bus and flow tests still pass with the in-process
   implementation.
3. Give notifications its own store. Copy the `outbox` table to a store that
   only the notifications service can reach. Dual-write for one release and
   compare the two. Check: row counts and message ids agree for a day.
4. Run notifications as a separate deployable. It consumes from the broker and
   has its own health check. Orders still uses the in-process bus at this
   point, so the broker only shadows it. Check: the consumer processes every
   event orders publishes, and the duplicate-drop rule works in a test.
5. Cut over and delete. Switch orders to the broker through the outbox relay,
   remove the in-process subscriber and the old table, and move `sent()` behind
   a read endpoint. Check: a ten-minute outage in staging leaves orders
   unaffected and delivers every confirmation on recovery.

## Where I would stop

- Stop before step 3 if there is no durable broker or outbox relay. Without
  them an outage loses confirmations, and splitting the service does not fix
  that.
- Stop after step 4 if the load or deploy signal from step 14 is not present.
  A separate service costs more than an in-process handler, so carry on only
  when that cost buys something measurable.
- Do not move orders' tables. Orders is not the module being extracted.

## What has to be true to carry on

- A durable broker exists, with dead-lettering and per-consumer lag metrics.
- Orders can write its event in the same transaction as the order.
- Notifications can deduplicate on `orderId`.
- The ten-minute outage test passes in staging.