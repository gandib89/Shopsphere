---- MODULE CheckoutPayment ----
\* eSewa checkout for one cart order group, from "Proceed to checkout" to a
\* confirmed (or cancelled) order. Every action names the code it stands for.
\*
\*   checkout            backend/controller/payment.js   checkout()
\*   callback steps      backend/controller/payment.js   processEsewaEvent()
\*   confirm steps       backend/controller/order.js     confirmOrderCore(), adjustStock()
\*   Cancel              backend/controller/order.js     cancelOrderCore()
\*
\* Scope: two orders from one cart (createBulkOrderFromCart gives them one
\* orderGroupId; checkout is called with the first one, "o1"), each holding the
\* last unit of its product. eSewa itself is modelled only as the status that
\* checkTransactionStatus() would return.
EXTENDS Naturals, FiniteSets, Sequences

CONSTANTS MaxPay,     \* checkout intents the customer may create (retries after a failure)
          Deliveries  \* times each eSewa redirect may reach the success/failure handler

Orders     == {"o1", "o2"}
Primary    == "o1"
GroupOrder == <<"o1", "o2">>   \* ordersToConfirm: read once, confirmed one transaction each
Pays       == 1..MaxPay
Callbacks  == Pays \X (1..Deliveries)

VARIABLES status,  \* orders.status
          stock,   \* products.quantity (0 or 1) of each order's product
          held,    \* units this order took from stock at confirm time
          sold,    \* units another buyer took
          nPay,    \* payment rows created so far
          pay,     \* payments.status
          gw,      \* what eSewa's status check reports for that transaction_uuid
          events,  \* gatewayEventIds recorded in payment_events (unique)
          pc,      \* where each redirect handler is in processEsewaEvent
          seen,    \* the status that handler got back from checkTransactionStatus
          idx      \* which group order confirmOrderCore's loop is on

vars == <<status, stock, held, sold, nPay, pay, gw, events, pc, seen, idx>>

GwStatus == {"none", "PENDING", "COMPLETE", "CANCELED"}

TypeOK ==
  /\ status \in [Orders -> {"Pending", "Confirming", "Confirmed", "Cancelled"}]
  /\ stock \in [Orders -> 0..1]
  /\ held \in [Orders -> 0..1]
  /\ sold \in [Orders -> 0..1]
  /\ nPay \in 0..MaxPay
  /\ pay \in [Pays -> {"none", "Initiated", "Succeeded", "Failed"}]
  /\ gw \in [Pays -> GwStatus]
  /\ events \subseteq (Pays \X GwStatus)
  /\ pc \in [Callbacks -> {"idle", "check", "confirm", "loop", "mark", "done"}]
  /\ seen \in [Callbacks -> GwStatus]
  /\ idx \in [Callbacks -> 1..Len(GroupOrder)]

Init ==
  /\ status = [o \in Orders |-> "Pending"]
  /\ stock = [o \in Orders |-> 1]
  /\ held = [o \in Orders |-> 0]
  /\ sold = [o \in Orders |-> 0]
  /\ nPay = 0
  /\ pay = [p \in Pays |-> "none"]
  /\ gw = [p \in Pays |-> "none"]
  /\ events = {}
  /\ pc = [c \in Callbacks |-> "idle"]
  /\ seen = [c \in Callbacks |-> "none"]
  /\ idx = [c \in Callbacks |-> 1]

\* checkout(): one withIdempotency transaction. The order must be Pending; an
\* existing Initiated intent is reused without a write (and the partial unique
\* index payments_one_initiated_per_order_idx forbids a second one).
Checkout ==
  /\ status[Primary] = "Pending"
  /\ \A p \in Pays : pay[p] # "Initiated"
  /\ nPay < MaxPay
  /\ nPay' = nPay + 1
  /\ pay' = [pay EXCEPT ![nPay + 1] = "Initiated"]
  /\ UNCHANGED <<status, stock, held, sold, gw, events, pc, seen, idx>>

\* The customer submits the signed form at eSewa. eSewa reports PENDING until
\* it settles (assumption: the status API can lag the redirect).
CustomerPays(p) ==
  /\ pay[p] # "none"
  /\ gw[p] = "none"
  /\ gw' = [gw EXCEPT ![p] = "PENDING"]
  /\ UNCHANGED <<status, stock, held, sold, nPay, pay, events, pc, seen, idx>>

GatewaySettles(p) ==
  /\ gw[p] = "PENDING"
  /\ \E r \in {"COMPLETE", "CANCELED"} : gw' = [gw EXCEPT ![p] = r]
  /\ UNCHANGED <<status, stock, held, sold, nPay, pay, events, pc, seen, idx>>

\* Another customer buys the last unit while this order is still unpaid.
OtherBuyerTakesStock(o) ==
  /\ status[o] = "Pending"
  /\ stock[o] = 1
  /\ stock' = [stock EXCEPT ![o] = 0]
  /\ sold' = [sold EXCEPT ![o] = 1]
  /\ UNCHANGED <<status, held, nPay, pay, gw, events, pc, seen, idx>>

\* cancelOrderCore(): atomic status-conditional claim; stock comes back only
\* from Confirmed.
Cancel(o) ==
  /\ status[o] \in {"Pending", "Confirmed"}
  /\ status' = [status EXCEPT ![o] = "Cancelled"]
  /\ IF status[o] = "Confirmed"
       THEN /\ stock' = [stock EXCEPT ![o] = @ + 1]
            /\ held' = [held EXCEPT ![o] = @ - 1]
       ELSE UNCHANGED <<stock, held>>
  /\ UNCHANGED <<sold, nPay, pay, gw, events, pc, seen, idx>>

\* processEsewaEvent(), step 1: payment.findUnique. A non-Initiated payment is
\* "alreadyProcessed". A redirect exists once the customer has been to eSewa.
CbRead(c) ==
  /\ pc[c] = "idle"
  /\ gw[c[1]] # "none"
  /\ pc' = [pc EXCEPT ![c] = IF pay[c[1]] = "Initiated" THEN "check" ELSE "done"]
  /\ UNCHANGED <<status, stock, held, sold, nPay, pay, gw, events, seen, idx>>

\* Step 2: checkTransactionStatus(). Only COMPLETE leads to confirmOrderCore.
CbCheck(c) ==
  /\ pc[c] = "check"
  /\ seen' = [seen EXCEPT ![c] = gw[c[1]]]
  /\ pc' = [pc EXCEPT ![c] = IF gw[c[1]] = "COMPLETE" THEN "confirm" ELSE "mark"]
  /\ UNCHANGED <<status, stock, held, sold, nPay, pay, gw, events, idx>>

\* confirmOrderCore(payment.orderId): primary not Pending => alreadyConfirmed no-op.
CbConfirmStart(c) ==
  /\ pc[c] = "confirm"
  /\ pc' = [pc EXCEPT ![c] = IF status[Primary] = "Pending" THEN "loop" ELSE "mark"]
  /\ idx' = [idx EXCEPT ![c] = 1]
  /\ UNCHANGED <<status, stock, held, sold, nPay, pay, gw, events, seen>>

\* One prisma.$transaction per group order: claim Pending -> Confirming, then
\* adjustStock(-1). When adjustStock returns null (no stock) the callback
\* returns normally, so the transaction COMMITS the Confirming claim.
CbConfirmOne(c) ==
  LET o == GroupOrder[idx[c]] IN
  /\ pc[c] = "loop"
  /\ IF status[o] # "Pending"
       THEN UNCHANGED <<status, stock, held>>
       ELSE IF stock[o] >= 1
              THEN /\ status' = [status EXCEPT ![o] = "Confirmed"]
                   /\ stock' = [stock EXCEPT ![o] = @ - 1]
                   /\ held' = [held EXCEPT ![o] = @ + 1]
              ELSE /\ status' = [status EXCEPT ![o] = "Confirming"]
                   /\ UNCHANGED <<stock, held>>
  /\ IF idx[c] = Len(GroupOrder)
       THEN /\ pc' = [pc EXCEPT ![c] = "mark"]
            /\ UNCHANGED idx
       ELSE /\ idx' = [idx EXCEPT ![c] = @ + 1]
            /\ UNCHANGED pc
  /\ UNCHANGED <<sold, nPay, pay, gw, events, seen>>

\* Final transaction: insert payment_events with gatewayEventId
\* "<uuid>:<status>" (unique; a duplicate is P2002 => no-op), then an
\* UNCONDITIONAL payment.update to Succeeded or Failed.
CbMark(c) ==
  LET p  == c[1]
      ev == <<p, seen[c]>>
  IN /\ pc[c] = "mark"
     /\ pc' = [pc EXCEPT ![c] = "done"]
     /\ IF ev \in events
          THEN UNCHANGED <<events, pay>>
          ELSE /\ events' = events \cup {ev}
               /\ pay' = [pay EXCEPT ![p] = IF seen[c] = "COMPLETE" THEN "Succeeded" ELSE "Failed"]
     /\ UNCHANGED <<status, stock, held, sold, nPay, gw, seen, idx>>

\* Nothing in flight: the flow may rest here.
Done ==
  /\ \A c \in Callbacks : pc[c] \in {"idle", "done"}
  /\ UNCHANGED vars

Next ==
  \/ Checkout
  \/ \E p \in Pays : CustomerPays(p)
  \/ \E p \in Pays : GatewaySettles(p)
  \/ \E o \in Orders : OtherBuyerTakesStock(o)
  \/ \E o \in Orders : Cancel(o)
  \/ \E c \in Callbacks : CbRead(c)
  \/ \E c \in Callbacks : CbCheck(c)
  \/ \E c \in Callbacks : CbConfirmStart(c)
  \/ \E c \in Callbacks : CbConfirmOne(c)
  \/ \E c \in Callbacks : CbMark(c)
  \/ Done

Spec == Init /\ [][Next]_vars

\* ---------------------------------------------------------------- rules

\* An order is never left in "Confirming": no transition, cancel, or refund
\* path leads out of it, so a paid order stuck there is stranded.
NoOrderStuckConfirming == \A o \in Orders : status[o] # "Confirming"

\* When eSewa took the customer's money, ShopSphere never records the payment
\* as Failed (a Failed payment can never be refunded or re-confirmed).
ChargeNeverRecordedAsFailed == \A p \in Pays : gw[p] = "COMPLETE" => pay[p] # "Failed"

\* No order is confirmed (stock taken, confirmation email sent) unless eSewa
\* reported a completed charge for this purchase.
ConfirmedOnlyAfterCharge ==
  \A o \in Orders : status[o] = "Confirmed" => \E p \in Pays : gw[p] = "COMPLETE"

\* Each unit is in stock, held by the order, or sold to someone else, exactly once.
StockConserved == \A o \in Orders : stock[o] + held[o] + sold[o] = 1

\* Only a confirmed order holds stock: cancelling gives the unit back.
OnlyConfirmedOrdersHoldStock == \A o \in Orders : held[o] = 1 <=> status[o] = "Confirmed"

\* The customer is never shown two payable eSewa forms for one purchase.
OneActiveIntent == Cardinality({p \in Pays : pay[p] = "Initiated"}) <= 1
====
