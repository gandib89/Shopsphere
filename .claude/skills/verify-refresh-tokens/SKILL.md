---
name: verify-refresh-tokens
description: Model-check ShopSphere's rotating refresh-token families (rotation, reuse detection, logout) with TLA+/TLC. Use when a change touches backend/utils/refreshTokenStore.js, refresh/logout in backend/controller/auth.js, or the RefreshToken model, or when asked whether a stolen or replayed refresh token can keep a session alive.
---

# Verify refresh-token rotation

The model in `verification/tla/refresh_tokens/RefreshTokens.tla` checks every interleaving for one login's token family. Two clients may hold the same cookie: your second tab, or a thief who copied it. Either one may refresh at any moment, and you may log out.

## Does my change touch this?

| Code | Model |
|---|---|
| `backend/utils/refreshTokenStore.js` `rotateRefreshToken` | `Read` (findUnique and its checks), `MarkUsed` (update usedAt), `Issue` (createInFamily) |
| `backend/utils/refreshTokenStore.js` `revokeFamilyByToken`, `revokeFamily` | `Logout`, reuse branch of `Read` |
| `backend/utils/refreshTokenStore.js` `issueRefreshFamily` | `Init` |
| `backend/controller/auth.js` `refresh`, `logout` | entry points; no transaction around rotation |

**Last confirmed in sync at commit `2861164`.** Run `git diff 2861164 -- <files above>`. Move the commit forward only after you have confirmed the model still matches the code.

## Run

```sh
JAVA=/path/to/java11+ verification/tla/run.sh verification/tla/refresh_tokens
```

TLC 1.7.4 and Java 11 or later are needed. It takes about 3 seconds and checks 14,704 states with `MaxTokens = 4`. `FixedClaim = FALSE` models the code today. Setting it to `TRUE` in a copy of the config models the fix "`updateMany` where `usedAt` and `revokedAt` are null; count 0 means 401, plus family revocation if the token was used".

## Expected result today

Three rules break. These are open findings:

- **EachTokenRotatesOnce** and **AtMostOneLiveToken.** Each token can be exchanged once, and a login never has two working tokens. *Breaks:* two refreshes with the same token race. Both `findUnique` calls see `usedAt = null`, both run the unconditional `update`, and both create a successor. The family forks, and reuse detection never fires. With a stolen cookie, the thief and the victim both keep working sessions. The real-code replay (two concurrent `rotateRefreshToken` calls on an in-memory client) reproduces this.
- **LogoutSticks.** After logout or reuse detection, no refresh token for the login works. *Breaks:* a refresh has passed its checks, you log out (the family is revoked), and then the in-flight refresh creates a new, unrevoked token. This **still breaks with `FixedClaim = TRUE`**. Fully fixing it needs rotation and revocation to serialise, for example a transaction that locks the family's rows, or a revoked-family marker checked at create time.

`TypeOK` and `RevokedStaysRevoked` hold. `RevokedStaysRevoked` was seen failing on a model where Issue un-revokes the family.

## Reading a result

Read a trace with the `/statechart` skill (`verification/tla/refresh_tokens/flow.cfg` with `MaxTokens = 2`, plus `chart-view.ts`), then replay it on the code. A step the code can't take means the model is wrong. Fix the action, not the rule. After a fix lands, run again with the config that matches the new code, and update "Expected result today".

## What this does not cover

Token expiry, `revokeAllFamiliesForUser` (password reset, account deletion), the access-token JWT, cookie flags, and more than two clients or four tokens.
