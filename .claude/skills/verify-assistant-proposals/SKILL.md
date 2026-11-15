---
name: verify-assistant-proposals
description: Model-check ShopSphere's assistant cart-proposal execution (pending -> executed/expired/stale/rejected, exactly-once apply, outbox) with TLA+/TLC. Use when a change touches executeProposal/transitionPending/applyStoredAction in backend/routes/proposalExecutionRoute.js, proposeCartChange in backend/services/assistantProposals.js, or cart version bumps in backend/controller/cartController.js, or when asked whether a confirmed proposal can apply twice or to the wrong cart.
---

# Verify assistant cart proposals

The model in `verification/tla/assistant_proposals/AssistantProposals.tla` checks every interleaving of one cart proposal (`cart.add_item`, `update_quantity`, or `remove_item`) being confirmed. It allows up to two concurrent Confirm requests, the shopper editing the cart in the storefront, the product selling out, and the ten-minute expiry.

## Does my change touch this?

| Code | Model |
|---|---|
| `backend/routes/proposalExecutionRoute.js` `executeProposal`, cart path steps 1-3 | `Load`, `Expire` |
| same, step 5 (cart version check) and step 6 (revalidation) | `CheckCart`, `Stale`, `Reject` |
| same, step 7 `transitionPending` and step 8 `applyStoredAction` and `writeOutbox` | `Claim`, `Apply` |
| `backend/services/assistantProposals.js` `proposeCartChange` (pins `expectedVersion`) | `Init`, `Expected` |
| `backend/controller/cartController.js` every `version: { increment: 1 }` | `StorefrontCartWrite` |

The order.cancel, return, listing, price, inventory and fulfilment kinds are **not** modelled. They use compare-and-swap writes, which are the pattern `FixedApply = TRUE` models.

**Last confirmed in sync at commit `2861164`.** Run `git diff 2861164 -- <files above>`. Move the commit forward only after you have confirmed the model still matches the code.

## Run

```sh
JAVA=/path/to/java11+ verification/tla/run.sh verification/tla/assistant_proposals
```

TLC 1.7.4 and Java 11 or later are needed. It takes about 2 seconds and checks 894 states. `FixedApply = FALSE` models the code today. Set it to `TRUE` in a copy of the config to model a step-8 cart write that is a compare-and-swap on `version = expectedVersion` and rolls back on count 0. With that setting, every rule holds (714 states).

## Expected result today

One rule breaks. This is an open finding:

- **AppliedOnlyToPreviewedCart.** The change the shopper approved is applied only to the cart they previewed. *Breaks:* you press Confirm. Step 5 reads the cart at the previewed version and step 7 claims the proposal. Before step 8 writes, a storefront cart edit commits: the cart row isn't locked, and `cart.update` increments the version unconditionally. The proposal is then applied on top of a cart that is not the one you approved. For example, an `update_quantity` overwrites the quantity you just set in the store, and the preview totals no longer match. This was not replayed against a live database. The model rests on Prisma's default READ COMMITTED isolation and on step 5 being a plain `findFirst`.

These rules hold: `TypeOK`, `AppliedAtMostOnce`, `ChangeMeansExecuted`, `OneOutcomeRecorded`, `OutcomeIsFinal`. Each was seen failing on a broken model: a claim without the pending check, an outbox write on count 0, and a terminal write without the pending guard.

## Reading a result

Read a trace with the `/statechart` skill (`verification/tla/assistant_proposals/flow.cfg` plus `chart-view.ts`), then replay it on the code. A step the code can't take means the model is wrong. Fix the action, not the rule.

## What this does not cover

The role and reauthorisation checks, MCP read paths (`getMyActionStatus`), RLS, preview price maths, the item being deleted mid-execution (the update throws and the whole transaction rolls back), and the non-cart proposal kinds.
