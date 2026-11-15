---- MODULE AssistantProposals ----
\* One assistant cart proposal (cart.add_item / update_quantity / remove_item)
\* from "pending" to its single outcome, with the shopper's own storefront
\* cart edits and the clock running alongside.
\*
\*   proposal created      backend/services/assistantProposals.js   proposeCartChange()  (Init: pending, pinned version)
\*   executor steps        backend/routes/proposalExecutionRoute.js executeProposal(), steps 1-8 (cart path)
\*   StorefrontCartWrite   backend/controller/cartController.js      any cart write: version { increment: 1 }
\*
\* executeProposal runs in one prisma.$transaction at READ COMMITTED. Reads
\* see committed data; the conditional transitionPending UPDATE re-evaluates
\* after a concurrent winner commits. The cart row is NOT locked by the
\* version read in step 5, so storefront writes can commit between step 5 and
\* step 8.
\*
\* FixedApply = TRUE models the fix "make the step-8 cart write a compare-and-
\* swap on version = expectedVersion and roll back on count 0" (what the price
\* and inventory paths already do). FALSE is the code today.
EXTENDS Naturals, Sequences

CONSTANTS Executors,       \* concurrent "Confirm" clicks for the same proposal
          MaxCartWrites,   \* storefront cart edits the shopper makes meanwhile
          FixedApply

Expected == 0   \* proposals.expectedVersion: the cart version the preview was computed at

VARIABLES status,      \* proposals.status
          expired,     \* now >= expiresAt (ten minutes after creation)
          soldOut,     \* the add_item product is archived or out of stock
          cartVersion, \* carts.version
          writes,      \* storefront writes so far
          appliedAt,   \* cart versions the proposal's change was applied on top of
          outbox,      \* proposal_outbox_events, in order
          pc           \* where each executor is

vars == <<status, expired, soldOut, cartVersion, writes, appliedAt, outbox, pc>>

TypeOK ==
  /\ status \in {"pending", "executed", "expired", "stale", "rejected"}
  /\ expired \in BOOLEAN
  /\ soldOut \in BOOLEAN
  /\ cartVersion \in Nat
  /\ pc \in [Executors -> {"idle", "expire", "checkCart", "stale", "reject", "claim", "apply", "done"}]

Init ==
  /\ status = "pending"
  /\ expired = FALSE
  /\ soldOut = FALSE
  /\ cartVersion = Expected
  /\ writes = 0
  /\ appliedAt = <<>>
  /\ outbox = <<"created">>
  /\ pc = [e \in Executors |-> "idle"]

TimePasses ==
  /\ ~expired
  /\ expired' = TRUE
  /\ UNCHANGED <<status, soldOut, cartVersion, writes, appliedAt, outbox, pc>>

StorefrontCartWrite ==
  /\ writes < MaxCartWrites
  /\ cartVersion' = cartVersion + 1
  /\ writes' = writes + 1
  /\ UNCHANGED <<status, expired, soldOut, appliedAt, outbox, pc>>

ProductSellsOut ==
  /\ ~soldOut
  /\ soldOut' = TRUE
  /\ UNCHANGED <<status, expired, cartVersion, writes, appliedAt, outbox, pc>>

\* Steps 1-3: load; a non-pending proposal replays its outcome; past
\* expiresAt goes to the expire claim.
Load(e) ==
  /\ pc[e] = "idle"
  /\ pc' = [pc EXCEPT ![e] = IF status # "pending" THEN "done"
                             ELSE IF expired THEN "expire" ELSE "checkCart"]
  /\ UNCHANGED <<status, expired, soldOut, cartVersion, writes, appliedAt, outbox>>

\* transitionPending(...) + writeOutbox only when count = 1.
Terminal(e, s) ==
  /\ pc' = [pc EXCEPT ![e] = "done"]
  /\ IF status = "pending"
       THEN /\ status' = s
            /\ outbox' = Append(outbox, s)
       ELSE UNCHANGED <<status, outbox>>
  /\ UNCHANGED <<expired, soldOut, cartVersion, writes, appliedAt>>

Expire(e) == pc[e] = "expire" /\ Terminal(e, "expired")

\* Steps 5-6: cart version must equal expectedVersion (else stale); the
\* product must still be sellable (else rejected).
CheckCart(e) ==
  /\ pc[e] = "checkCart"
  /\ pc' = [pc EXCEPT ![e] = IF cartVersion # Expected THEN "stale"
                             ELSE IF soldOut THEN "reject" ELSE "claim"]
  /\ UNCHANGED <<status, expired, soldOut, cartVersion, writes, appliedAt, outbox>>

Stale(e)  == pc[e] = "stale"  /\ Terminal(e, "stale")
Reject(e) == pc[e] = "reject" /\ Terminal(e, "rejected")

\* Step 7: the exactly-once claim. Count 0 => replay the winner.
\* With FixedApply the step-8 write is a CAS in the same transaction, so a
\* moved cart rolls the claim back: the proposal stays pending (409).
Claim(e) ==
  /\ pc[e] = "claim"
  /\ IF status # "pending"
       THEN /\ pc' = [pc EXCEPT ![e] = "done"]
            /\ UNCHANGED <<status, cartVersion, appliedAt, outbox>>
       ELSE IF ~FixedApply
         THEN /\ status' = "executed"
              /\ pc' = [pc EXCEPT ![e] = "apply"]
              /\ UNCHANGED <<cartVersion, appliedAt, outbox>>
         ELSE IF cartVersion = Expected
           THEN /\ status' = "executed"
                /\ appliedAt' = Append(appliedAt, cartVersion)
                /\ cartVersion' = cartVersion + 1
                /\ outbox' = Append(outbox, "executed")
                /\ pc' = [pc EXCEPT ![e] = "done"]
           ELSE /\ pc' = [pc EXCEPT ![e] = "done"]
                /\ UNCHANGED <<status, cartVersion, appliedAt, outbox>>
  /\ UNCHANGED <<expired, soldOut, writes>>

\* Step 8: applyStoredAction + cart.update({ version: { increment: 1 } }) + outbox.
Apply(e) ==
  /\ pc[e] = "apply"
  /\ appliedAt' = Append(appliedAt, cartVersion)
  /\ cartVersion' = cartVersion + 1
  /\ outbox' = Append(outbox, "executed")
  /\ pc' = [pc EXCEPT ![e] = "done"]
  /\ UNCHANGED <<status, expired, soldOut, writes>>

Done ==
  /\ \A e \in Executors : pc[e] \in {"idle", "done"}
  /\ UNCHANGED vars

Next ==
  \/ TimePasses
  \/ StorefrontCartWrite
  \/ ProductSellsOut
  \/ \E e \in Executors : Load(e)
  \/ \E e \in Executors : Expire(e)
  \/ \E e \in Executors : CheckCart(e)
  \/ \E e \in Executors : Stale(e)
  \/ \E e \in Executors : Reject(e)
  \/ \E e \in Executors : Claim(e)
  \/ \E e \in Executors : Apply(e)
  \/ Done

Spec == Init /\ [][Next]_vars

\* ---------------------------------------------------------------- rules

\* The change the shopper approved is applied only to the cart they previewed;
\* if the cart moved on, the proposal goes stale instead.
AppliedOnlyToPreviewedCart == \A i \in DOMAIN appliedAt : appliedAt[i] = Expected

\* The approved change is applied at most once, however many times "Confirm" is pressed.
AppliedAtMostOnce == Len(appliedAt) <= 1

\* The cart changes only for a proposal whose status says "executed".
ChangeMeansExecuted == Len(appliedAt) > 0 => status = "executed"

\* The outbox records exactly one outcome, and it is the proposal's status.
OneOutcomeRecorded ==
  /\ Len(outbox) <= 2
  /\ Len(outbox) = 2 => outbox[2] = status

\* Once a proposal leaves pending, its outcome never changes.
OutcomeIsFinal == [][status # "pending" => status' = status]_vars
====
