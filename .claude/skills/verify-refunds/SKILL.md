---
name: verify-refunds
description: Model-check ShopSphere's post-payment order lifecycle (seller fulfilment, cancel, return request/approve/reject, admin refund release) with TLA+/TLC. Use when a change touches backend/services/refundService.js, releaseRefund/processReturn/requestReturn/cancelOrderCore/SELLER_FULFILLMENT_TRANSITIONS in backend/controller/order.js, or how payments attach to order groups, or when asked whether a refund can be wrong, doubled, or stuck.
---

# Verify refunds and returns

The model in `verification/tla/refunds/Refunds.tla` checks every interleaving for one paid cart order group: two orders, both `Confirmed` and paid by **one** eSewa payment that hangs off the first order. It covers the seller moving orders along, the customer cancelling or returning, the seller approving or rejecting a return, and up to two admins pressing "Release refund" at once. It also covers a server dying mid-refund and the admin retrying.

## Does my change touch this?

| Code | Model |
|---|---|
| `backend/controller/order.js` `SELLER_FULFILLMENT_TRANSITIONS`, `updateSellerOrderStatus` | `Advance` |
| `backend/controller/order.js` `cancelOrderCore` (from `Confirmed`) | `Cancel` |
| `backend/controller/order.js` `requestReturn`, `processReturn` | `RequestReturn`, `ApproveReturn`, `RejectReturn` |
| `backend/services/refundService.js` `processRefundCore`, `findRefundOrder` (via `releaseRefund`) | `Claim`, `ProviderCall`, `Settle` |
| `backend/services/refundProvider.js` | `ProviderCall` (succeeds or fails) |
| `backend/controller/payment.js` `checkout` (payment `orderId` = first order, amount = group total) | `PayOrder`, `PayAmount`, `HasPayment` |
| `backend/prisma/schema.prisma` `Refund.paymentId @unique` | one `refund` variable per payment |

**Last confirmed in sync at commit `2861164`.** Run `git diff 2861164 -- <files above>`. If it shows changes, check them against the model before you trust a result. Move the commit forward only after that check.

## Run

```sh
JAVA=/path/to/java11+ verification/tla/run.sh verification/tla/refunds
```

TLC 1.7.4 and Java 11 or later are needed, as for `verification/tla/run.sh`. It takes about 5 seconds and checks 16,862 states. `CONSTRAINT Bounded` only stops broken variants from paying out forever.

## Expected result today

Three rules break. These are open findings:

- **RefundMatchesReturnedOrders.** A refund never pays back more than the orders that were cancelled or returned. *Breaks:* you cancel item 1 of a two-item cart order, and the admin releases the refund. `processRefundCore` refunds `payment.amount`, which is the whole group total, while item 2 still ships.
- **EveryCancelledOrReturnedOrderIsRefundable.** Every paid order that is cancelled or returned can be refunded. *Breaks:* you cancel item 2 (or return it). `findRefundOrder` looks for payments with `orderId` = item 2, and there are none, because the group's single payment row points at item 1. Every refund attempt then gets a 409, "A succeeded payment is required". Once item 1 has been refunded, the unique `paymentId` blocks any second refund as well.
- **RefundNeverWedged.** A refund is `Processing` only while a worker is processing it. *Breaks:* the process dies (deploy, timeout, lost DB connection) between the claim transaction and the settle transaction. The row stays `Processing`, and every retry gets a 409, "already processing", for good. Nothing in the code ever moves it on.

The other rules hold: `TypeOK`, `PaidBackAtMostOnce` (two admins can't double-refund), `ReleasedMeansRefunded`, `StockBackOnlyForReturnedGoods`. Each was seen failing on a broken model: a claim that ignores `Processing`, a release on a failed refund, and a reject that restores stock.

## Reading a result

A new broken rule: read the trace that `run.sh` prints with the `/statechart` skill (`verification/tla/refunds/flow.cfg` plus `chart-view.ts`; `flow.cfg` uses `FlowBound` to keep item 2 either kept or cancelled). Then replay it on the code, one action per step. If the code can't take a step, fix the model action. Otherwise it is a real bug. Never weaken a rule to get a pass. When a fix lands, update "Expected result today".

## Changing the model

Each database transaction is one atomic step. Each provider call is its own step, and so is the gap between steps (`Crash`). Keep the code reference in each action's comment.

## What this does not cover

The 7-day return window (assumed open), the Pending-order cancel (see `verify-checkout-payment`), seller ownership checks, the admin manual override in `updateSellerOrderStatus`, emails, revenue reversal amounts, refund amounts beyond "price 1 per order", and more than two orders or two admins.
