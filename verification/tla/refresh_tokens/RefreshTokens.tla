---- MODULE RefreshTokens ----
\* One login's refresh-token family: rotation, reuse detection, logout.
\*
\*   Read / MarkUsed / Issue   backend/utils/refreshTokenStore.js   rotateRefreshToken(), via POST /auth/refresh (controller/auth.js refresh())
\*   Logout                    backend/utils/refreshTokenStore.js   revokeFamilyByToken()
\*
\* rotateRefreshToken() runs on the plain prisma client (no transaction): a
\* findUnique, then an UNCONDITIONAL update of usedAt, then a create. Each is
\* one step here. Two clients may hold the same token: your second browser tab,
\* or a thief who copied the cookie.
\*
\* FixedClaim = TRUE models the fix "updateMany({ where: { id, usedAt: null } })
\* and treat count 0 as reuse"; FALSE is the code today.
EXTENDS Naturals, FiniteSets, Sequences

CONSTANTS Clients, MaxTokens, FixedClaim

VARIABLES used,     \* refresh_tokens.usedAt is set, per token
          revoked,  \* refresh_tokens.revokedAt is set, per token
          parent,   \* the token this one was rotated from (0 = issued at login)
          holds,    \* tokens each client has a copy of
          pc,       \* where each client's refresh request is
          tok,      \* the token that request presented
          ended     \* logout or reuse detection has ended this login

vars == <<used, revoked, parent, holds, pc, tok, ended>>

Tokens == 1..Len(used)

TypeOK ==
  /\ Len(used) = Len(revoked) /\ Len(used) = Len(parent)
  /\ holds \in [Clients -> SUBSET Tokens]
  /\ pc \in [Clients -> {"idle", "valid", "issue"}]
  /\ tok \in [Clients -> 0..MaxTokens]
  /\ ended \in BOOLEAN

\* Login (issueRefreshFamily) gave the first client token 1.
Init ==
  /\ used = <<FALSE>>
  /\ revoked = <<FALSE>>
  /\ parent = <<0>>
  /\ holds = [c \in Clients |-> IF c = CHOOSE x \in Clients : TRUE THEN {1} ELSE {}]
  /\ pc = [c \in Clients |-> "idle"]
  /\ tok = [c \in Clients |-> 0]
  /\ ended = FALSE

\* Another client gets a copy of a token (second tab, or a stolen cookie).
Copy(c, d) ==
  /\ c # d
  /\ holds[c] # {}
  /\ \E t \in holds[c] : holds' = [holds EXCEPT ![d] = @ \cup {t}]
  /\ UNCHANGED <<used, revoked, parent, pc, tok, ended>>

\* findUnique by hash. Revoked => 401. usedAt set => reuse: revoke the family, 401.
Read(c, t) ==
  /\ pc[c] = "idle"
  /\ t \in holds[c]
  /\ Len(used) < MaxTokens
  /\ IF revoked[t]
       THEN UNCHANGED <<revoked, pc, tok, ended>>
       ELSE IF used[t]
         THEN /\ revoked' = [i \in Tokens |-> TRUE]
              /\ ended' = TRUE
              /\ UNCHANGED <<pc, tok>>
         ELSE /\ pc' = [pc EXCEPT ![c] = "valid"]
              /\ tok' = [tok EXCEPT ![c] = t]
              /\ UNCHANGED <<revoked, ended>>
  /\ UNCHANGED <<used, parent, holds>>

\* update({ where: { id }, data: { usedAt } }) -- unconditional today.
\* Fixed: updateMany where usedAt and revokedAt are null; count 0 => 401,
\* and if it was already used, revoke the family as reuse.
MarkUsed(c) ==
  LET t == tok[c] IN
  /\ pc[c] = "valid"
  /\ IF FixedClaim /\ (used[t] \/ revoked[t])
       THEN /\ revoked' = [i \in Tokens |-> TRUE]
            /\ ended' = TRUE
            /\ pc' = [pc EXCEPT ![c] = "idle"]
       ELSE /\ pc' = [pc EXCEPT ![c] = "issue"]
            /\ UNCHANGED <<revoked, ended>>
  /\ used' = [used EXCEPT ![t] = TRUE]
  /\ UNCHANGED <<parent, holds, tok>>

\* createInFamily: the new token goes into the client's cookie.
Issue(c) ==
  /\ pc[c] = "issue"
  /\ used' = Append(used, FALSE)
  /\ revoked' = Append(revoked, FALSE)
  /\ parent' = Append(parent, tok[c])
  /\ holds' = [holds EXCEPT ![c] = {Len(used) + 1}]
  /\ pc' = [pc EXCEPT ![c] = "idle"]
  /\ UNCHANGED <<tok, ended>>

\* POST /auth/logout: revokeFamilyByToken.
Logout(c) ==
  /\ pc[c] = "idle"
  /\ holds[c] # {}
  /\ revoked' = [i \in Tokens |-> TRUE]
  /\ ended' = TRUE
  /\ UNCHANGED <<used, parent, holds, pc, tok>>

Done ==
  /\ \A c \in Clients : pc[c] = "idle"
  /\ UNCHANGED vars

Next ==
  \/ \E c, d \in Clients : Copy(c, d)
  \/ \E c \in Clients, t \in 1..MaxTokens : Read(c, t)
  \/ \E c \in Clients : MarkUsed(c)
  \/ \E c \in Clients : Issue(c)
  \/ \E c \in Clients : Logout(c)
  \/ Done

Spec == Init /\ [][Next]_vars

\* ---------------------------------------------------------------- rules

Live == {t \in Tokens : ~used[t] /\ ~revoked[t]}

\* Each refresh token can be exchanged for a new one at most once.
EachTokenRotatesOnce ==
  \A t \in Tokens : Cardinality({u \in Tokens : parent[u] = t}) <= 1

\* A login never has two working refresh tokens at once, so a copied token
\* always collides with the real one and reuse detection fires.
AtMostOneLiveToken == Cardinality(Live) <= 1

\* After logout or reuse detection, no refresh token for this login works.
LogoutSticks == ended => Live = {}

\* A revoked token is never un-revoked.
RevokedStaysRevoked == [][\A t \in Tokens : revoked[t] => revoked'[t]]_vars
====
