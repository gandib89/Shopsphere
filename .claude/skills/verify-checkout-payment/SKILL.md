---
name: verify-checkout-payment
description: Model-check ShopSphere's eSewa checkout flow (checkout intent, eSewa redirect handling, order confirmation, stock, cancel) with TLA+/TLC. Use when a change touches backend/controller/payment.js, confirmOrderCore/cancelOrderCore/adjustStock in backend/controller/order.js, or backend/utils/idempotency.js, or when asked whether a paid order can get stuck or a charge can be lost.
---

# Verify checkout and payment

The model in `verification/tla/checkout_payment/CheckoutPayment.tla` checks every interleaving of one cart order group (two orders, one eSewa payment) going through checkout: the customer paying at eSewa, eSewa settling, the success or failure redirect arriving (more than once), confirmation, another buyer taking the last unit, and the customer cancelling.

## Does my change touch this?

Yes, if the diff changes any of these. Each is one or more actions in the model, and the comment above each action names its code.

| Code | Model |
|---|---|
| `backend/controller/payment.js` `checkout` | `Checkout` |
| `backend/controller/payment.js` `processEsewaEvent`, `esewaSuccessWebhook`, `esewaFailureWebhook` | `CbRead`, `CbCheck`, `CbMark` |
| `backend/controller/order.js` `confirmOrderCore`, `adjustStock` | `CbConfirmStart`, `CbConfirmOne` |
| `backend/controller/order.js` `cancelOrderCore`, `isCancelEligible`, `CANCELLABLE_ORDER_STATUSES` | `Cancel` |
| `backend/utils/idempotency.js` `withIdempotency` | `Checkout` is one atomic step |
| `backend/prisma/migrations/20260829130000_one_active_payment_per_order` | the `Initiated` guard in `Checkout` |
| `backend/controller/order.js` `createBulkOrderFromCart`: one `orderGroupId`, checkout called with the first order | `Primary`, `GroupOrder` |

**Last confirmed in sync at commit `2861164`.** Run `git diff 2861164 -- <files above>`. If it shows changes, read them against the model before you trust a pass. Move this commit forward only after you have checked that the model still describes the code at the new commit.

## Run

```sh
JAVA=/path/to/java11+ verification/tla/run.sh verification/tla/checkout_payment
```

It needs TLC 1.7.4 (`TLA2TOOLS`, default `~/.cache/tla/tla2tools.jar`, checked by sha256) and Java 11 or later (`JAVA`). On Windows, run it from Git Bash. It takes about 10 seconds: 157,136 states with `MaxPay = 2` and `Deliveries = 2`.

## Expected result today

Two rules break. These are open findings, not modelling errors:

- **NoOrderStuckConfirming.** An order is never left in `Confirming`. *Breaks:* you pay, another buyer takes the last unit of one item, and eSewa completes the charge. `confirmOrderCore` claims the order (`Pending` to `Confirming`), `adjustStock` returns `null`, and the transaction callback returns normally, so the claim commits. Then `CbMark` records the payment as Succeeded. No transition, cancel (`isCancelEligible`), or refund (`processRefundCore` needs `Cancelled` or `Return Approved`) leads out of `Confirming`, so the customer has paid for an order that can never ship or be refunded.
- **ChargeNeverRecordedAsFailed.** When eSewa took the money, the payment is never recorded as Failed. *Breaks:* the redirect arrives while eSewa's status API still says `PENDING`. `processEsewaEvent` maps every status other than `COMPLETE` to `Failed`. eSewa then completes the charge, and every later redirect is `alreadyProcessed`. The customer is charged, the order stays `Pending`, and the payment can't be refunded. This rests on one assumption: that the status API can report PENDING (or AMBIGUOUS) after the redirect. eSewa documents these statuses as non-final. The real-code replay with an injected `checkStatus` reproduces it.

The other rules hold: `TypeOK`, `ConfirmedOnlyAfterCharge`, `StockConserved`, `OnlyConfirmedOrdersHoldStock`, `OneActiveIntent`.

Each of these was seen failing on a broken model: confirming without the status check, cancel without restocking, and checkout without the one-Initiated guard. A pass therefore means something. The skill was also followed end to end on a scratch edit, `stockRestored = false` in `cancelOrderCore`: mirroring it in `Cancel` breaks `OnlyConfirmedOrdersHoldStock`.

## Reading a result

- A **new** broken rule after your change: open the trace that `run.sh` prints. Read it with the `/statechart` skill, which tells the shortest path in plain steps. Use `verification/tla/checkout_payment/flow.cfg` and `chart-view.ts` there. Then replay the path against the code, one action per step. If the code really does that, it is a bug in your change. If the code can't take one of the steps, the model is wrong at that action: fix the action and its code comment, not the rule.
- **A finding disappears**: that is good if your change fixes it. Confirm by reading the fix against the action the trace went through, then update "Expected result today" above.
- Never weaken or delete a rule to make the run pass.

## Changing the model when the code changes on purpose

Edit the matching action so that it does exactly what the code does, where each database transaction is one atomic step and each separate query or awaited call outside a transaction is its own step. Keep the code reference in the comment. Rerun. To see the flow, use `/statechart` on `flow.cfg` (`MaxPay = 1`, `Deliveries = 1`, 352 states) with `chart-view.ts`.

## What this does not cover

Amounts and promo maths (`computeCheckoutAmount` has unit tests), eSewa signature checks, `confirmOrderAndDeductStock` (the manual confirm route), email and cart clearing, more than two orders in a group, more than two payment attempts, and more than two deliveries of each redirect. The status API is modelled only as PENDING, then COMPLETE or CANCELED.
