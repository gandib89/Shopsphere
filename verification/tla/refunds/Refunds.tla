---- MODULE Refunds ----
\* After payment: fulfilment, cancel, return, and the admin refund, for one
\* paid cart order group. Every action names the code it stands for.
\*
\*   Advance            backend/controller/order.js   SELLER_FULFILLMENT_TRANSITIONS, updateSellerOrderStatus()
\*   Cancel             backend/controller/order.js   cancelOrderCore()
\*   RequestReturn      backend/controller/order.js   requestReturn()
\*   Approve/Reject     backend/controller/order.js   processReturn()
\*   refund steps       backend/services/refundService.js   processRefundCore(), via releaseRefund()
\*
\* Scope: two orders from one cart, both Confirmed and paid by ONE eSewa payment.
\* checkout() is called with the first order, so the payment row has
\* orderId = "o1" and amount = both orders' total (computeCheckoutAmount).
\* The refund provider is modelled as "succeeds or fails"; Crash is a worker
\* dying (deploy, timeout, lost DB connection) between its transactions.
EXTENDS Naturals, FiniteSets

CONSTANTS Workers   \* concurrent releaseRefund requests (an admin double-click)

Orders    == {"o1", "o2"}
Price     == [o \in Orders |-> 1]
PayOrder  == "o1"
PayAmount == 2

Next1 == [s \in {"Confirmed", "Processing", "Shipped"} |->
            CASE s = "Confirmed" -> "Processing"
              [] s = "Processing" -> "Shipped"
              [] s = "Shipped" -> "Delivered"]

VARIABLES status,    \* orders.status
          held,      \* units the order holds (1 until stock is restored)
          refund,    \* refunds.status for the single payment (paymentId is unique)
          moneyOut,  \* money the provider has paid back
          pc,        \* where each releaseRefund worker is
          wo,        \* the order a worker is refunding
          claimed,   \* order status the worker saw when it claimed
          outcome    \* provider result the worker got

vars == <<status, held, refund, moneyOut, pc, wo, claimed, outcome>>

OrderStatus == {"Confirmed", "Processing", "Shipped", "Delivered", "Cancelled",
                "Return Requested", "Return Approved", "Return Rejected", "Refund Released"}

TypeOK ==
  /\ status \in [Orders -> OrderStatus]
  /\ held \in [Orders -> 0..1]
  /\ refund \in {"none", "Processing", "Succeeded", "Failed"}
  /\ moneyOut \in 0..(2 * PayAmount)
  /\ pc \in [Workers -> {"idle", "claimed", "called", "done"}]
  /\ wo \in [Workers -> Orders]
  /\ claimed \in [Workers -> OrderStatus]
  /\ outcome \in [Workers -> {"none", "Succeeded", "Failed"}]

Init ==
  /\ status = [o \in Orders |-> "Confirmed"]
  /\ held = [o \in Orders |-> 1]
  /\ refund = "none"
  /\ moneyOut = 0
  /\ pc = [w \in Workers |-> "idle"]
  /\ wo = [w \in Workers |-> "o1"]
  /\ claimed = [w \in Workers |-> "Confirmed"]
  /\ outcome = [w \in Workers |-> "none"]

\* The seller moves the order one step along Confirmed -> Processing -> Shipped -> Delivered.
Advance(o) ==
  /\ status[o] \in DOMAIN Next1
  /\ status' = [status EXCEPT ![o] = Next1[status[o]]]
  /\ UNCHANGED <<held, refund, moneyOut, pc, wo, claimed, outcome>>

\* cancelOrderCore(): Confirmed -> Cancelled, stock restored, refundRequired: "human".
Cancel(o) ==
  /\ status[o] = "Confirmed"
  /\ status' = [status EXCEPT ![o] = "Cancelled"]
  /\ held' = [held EXCEPT ![o] = 0]
  /\ UNCHANGED <<refund, moneyOut, pc, wo, claimed, outcome>>

\* requestReturn(): only from Delivered (the 7-day window is assumed open).
RequestReturn(o) ==
  /\ status[o] = "Delivered"
  /\ status' = [status EXCEPT ![o] = "Return Requested"]
  /\ UNCHANGED <<held, refund, moneyOut, pc, wo, claimed, outcome>>

\* processReturn(): one transaction, status-conditional claim; approve restores stock.
ApproveReturn(o) ==
  /\ status[o] = "Return Requested"
  /\ status' = [status EXCEPT ![o] = "Return Approved"]
  /\ held' = [held EXCEPT ![o] = 0]
  /\ UNCHANGED <<refund, moneyOut, pc, wo, claimed, outcome>>

RejectReturn(o) ==
  /\ status[o] = "Return Requested"
  /\ status' = [status EXCEPT ![o] = "Return Rejected"]
  /\ UNCHANGED <<held, refund, moneyOut, pc, wo, claimed, outcome>>

\* findRefundOrder(): payments with this orderId and status Succeeded.
HasPayment(o) == o = PayOrder

\* processRefundCore(), first transaction. Concurrent creates race on the
\* unique paymentId (P2002 -> 409), which this single atomic step reproduces.
Claim(w, o) ==
  /\ pc[w] = "idle"
  /\ wo' = [wo EXCEPT ![w] = o]
  /\ claimed' = [claimed EXCEPT ![w] = status[o]]
  /\ IF /\ HasPayment(o)
        /\ refund \in {"none", "Failed"}
        /\ status[o] \in {"Return Approved", "Cancelled"}
       THEN /\ refund' = "Processing"
            /\ pc' = [pc EXCEPT ![w] = "claimed"]
       ELSE /\ pc' = [pc EXCEPT ![w] = "done"]   \* 409 / replay: nothing written
            /\ UNCHANGED refund
  /\ UNCHANGED <<status, held, moneyOut, outcome>>

\* provider.refund(): money moves back for the payment's whole amount.
ProviderCall(w) ==
  /\ pc[w] = "claimed"
  /\ \E r \in {"Succeeded", "Failed"} :
       /\ outcome' = [outcome EXCEPT ![w] = r]
       /\ moneyOut' = IF r = "Succeeded" THEN moneyOut + PayAmount ELSE moneyOut
  /\ pc' = [pc EXCEPT ![w] = "called"]
  /\ UNCHANGED <<status, held, refund, wo, claimed>>

\* Second transaction: settle the Processing refund; on success flip the order
\* (status-conditional) to Refund Released. A lost order race throws and the
\* whole transaction rolls back.
Settle(w) ==
  LET o == wo[w] IN
  /\ pc[w] = "called"
  /\ pc' = [pc EXCEPT ![w] = "done"]
  /\ IF refund = "Processing" /\ (outcome[w] = "Failed" \/ status[o] = claimed[w])
       THEN /\ refund' = outcome[w]
            /\ status' = IF outcome[w] = "Succeeded"
                           THEN [status EXCEPT ![o] = "Refund Released"]
                           ELSE status
       ELSE UNCHANGED <<refund, status>>
  /\ UNCHANGED <<held, moneyOut, wo, claimed, outcome>>

\* The worker process dies between its two transactions.
Crash(w) ==
  /\ pc[w] \in {"claimed", "called"}
  /\ pc' = [pc EXCEPT ![w] = "done"]
  /\ UNCHANGED <<status, held, refund, moneyOut, wo, claimed, outcome>>

\* A finished worker's admin may press "Release refund" again.
Retry(w) ==
  /\ pc[w] = "done"
  /\ refund = "Failed"
  /\ pc' = [pc EXCEPT ![w] = "idle"]
  /\ UNCHANGED <<status, held, refund, moneyOut, wo, claimed, outcome>>

Done ==
  /\ \A w \in Workers : pc[w] \in {"idle", "done"}
  /\ UNCHANGED vars

Next ==
  \/ \E o \in Orders : Advance(o)
  \/ \E o \in Orders : Cancel(o)
  \/ \E o \in Orders : RequestReturn(o)
  \/ \E o \in Orders : ApproveReturn(o)
  \/ \E o \in Orders : RejectReturn(o)
  \/ \E w \in Workers, o \in Orders : Claim(w, o)
  \/ \E w \in Workers : ProviderCall(w)
  \/ \E w \in Workers : Settle(w)
  \/ \E w \in Workers : Crash(w)
  \/ \E w \in Workers : Retry(w)
  \/ Done

Spec == Init /\ [][Next]_vars

\* State bound for TLC: a broken variant that pays out repeatedly must not run forever.
Bounded == moneyOut <= 2 * PayAmount

\* Chart-only bound (flow.cfg): o2 is either left alone or cancelled, so the
\* chart shows o1's whole lifecycle plus the group-refund bugs within 500 states.
FlowBound == Bounded /\ status["o2"] \in {"Confirmed", "Cancelled"}

\* ---------------------------------------------------------------- rules

Refundable == {o \in Orders : status[o] \in {"Cancelled", "Return Approved", "Refund Released"}}

\* A refund never pays back more than the orders that were cancelled or returned.
RefundMatchesReturnedOrders == moneyOut <= Cardinality(Refundable)

\* Every paid order that is cancelled or returned can be refunded.
EveryCancelledOrReturnedOrderIsRefundable ==
  \A o \in Orders : status[o] \in {"Cancelled", "Return Approved"} => HasPayment(o)

\* The payment is paid back at most once.
PaidBackAtMostOnce == moneyOut <= PayAmount

\* An order shows "Refund Released" only when the refund really succeeded.
ReleasedMeansRefunded == \A o \in Orders : status[o] = "Refund Released" => refund = "Succeeded"

\* A refund is "Processing" only while a worker is actually processing it;
\* otherwise every retry gets 409 "already processing" forever.
RefundNeverWedged == refund = "Processing" => \E w \in Workers : pc[w] \in {"claimed", "called"}

\* Stock comes back only for cancelled or returned goods, and only once.
StockBackOnlyForReturnedGoods ==
  \A o \in Orders : held[o] = 0 => status[o] \in {"Cancelled", "Return Approved", "Refund Released"}
====
