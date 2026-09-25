# MCP private, draft, and proposal release gates

Use this runbook for issues [#31](https://github.com/gandib89/Shopsphere/issues/31) through [#36](https://github.com/gandib89/Shopsphere/issues/36). Copy the [evidence template](mcp-phased-release-evidence-template.md) into the private release record **once per issue and once per distinct proposal cohort**. These instructions define evidence to collect; they do not assert that any phase has passed. The [public pilot gate](mcp-public-pilot-runbook.md) for #30 must pass before any private read cohort is enabled.

## Release order

| Gate | Blocking issues and release prerequisite | Cohort order |
|---|---|---|
| #31 buyer reads | #10, #12, #13, and released #30 | Approved buyer accounts and client IDs only |
| #32 seller reads | #10, #14, #15, and released #30 | Approved verified sellers and client IDs only; test unverified seller denial |
| #33 admin reads | #10, #16, #17, #18, and released #30 | Narrow named staff cohort and exact admin scopes |
| #34 drafts | #19, #20, #21, and released #31, #32, #33 | Enable each role's draft tools independently; proposal flags stay off |
| #35 buyer proposals | #22, #24, #25, and released #31 | Cart first; cancellation and return later as separate cohorts |
| #36 seller proposals | #26, #27, #28, #29, and released #32, #35 | Listing content first; price/inventory next; fulfillment last |

“Released” means that the predecessor's actual staging and cohort release record is approved, not merely that its code merged or tests passed. #31, #32, and #33 may be validated independently once #30 passes. #35 need not wait for #34 or #33, but no enabled proposal may gain draft or admin authority by accident. Every new client, account cohort, tool, scope, schema, or policy change requires a fresh gate for the affected surface.

## Common gate for each phase

1. **Fix the release identity.** Record the deployed commit SHA, artifact digest, registry/policy version, environment, protocol, exact tool list and flags, consent scopes, approved client IDs/versions, named account cohort, operators, UTC window, and dashboards. Confirm prerequisite issue records and any schema/RLS migration and forward-repair evidence.
2. **Verify the code at that SHA.** Attach MCP, backend, and relevant frontend suite results plus generated role × scope × tool × ownership matrix results. Test both MCP discovery/dispatch and direct Express assistant routes. Include malformed, missing, disabled, revoked, wrong-role, wrong-scope, foreign-owner, and stale-grant cases. Repository results are preflight evidence only.
3. **Exercise the deployed staging stack.** Use synthetic buyer, seller, and staff fixtures with canary PII and secrets. Capture sanitized request/audit IDs and expected versus observed outcomes. Run PostgreSQL 16 RLS tests with pooled concurrency, rollback, timeout, connection reuse, cursor and session isolation, and multiple replicas where applicable. Verify direct legacy routes reject delegated credentials. Check that results, errors, audits, logs, and traces contain no forbidden data. Prove private calls fail closed on issuer, Redis, backend, database, and durable audit outages. Re-run the affected matrix against the deployed artifact.
4. **Prove limits and observability.** Exercise per-identity and daily quotas, concurrency, response size, pagination, latency/error thresholds, audit delivery, and alerts under the recorded load profile. Decide thresholds before the run. Confirm discovery and forged dispatch both deny each disabled tool; test the global kill switch and normal storefront availability. Staging observations require artifact links, not checkmarks or local harness output alone.
5. **Approve and observe.** Record security, privacy/data-processing, audit-retention, product/domain, and operations decisions applicable to the phase, with named approver, UTC time, and evidence. Capture a named rollback operator and tested steps before enablement. Start with the recorded client/account allowlist and tool flags. Widen only after the declared observation window meets its pre-set thresholds with no unresolved critical/high finding or unauthorized read/mutation.

Never put tokens, customer data, raw private responses, full prompts, or internal dashboard credentials in this public repository. Store completed records privately; attach redacted evidence links to the issue or release record.

## Phase-specific staging observations

| Gate | Required proof before enabling or widening |
|---|---|
| **#31 buyer reads** | The generated matrix denies every unauthenticated, wrong-role/scope, revoked, malformed, disabled, missing, and foreign-buyer combination at MCP and Express. Real PostgreSQL tests cover cross-buyer and nested records, legacy ownership, cursor/session/cache separation, pooled concurrency, failure cleanup, and RLS. Repeated cart/order/bill/payment-status reads cause no forbidden commerce side effect. No canary PII or credential reaches results or telemetry. Record external-client processing, privacy, and audit-retention approval. |
| **#32 seller reads** | Independently test verified/unverified sellers, live scopes/grants/flags, owned catalog and private stock, sale-line historical seller attribution, and revenue. PostgreSQL 16 cases cover cross-seller and multi-seller groups, current owner versus seller at purchase, aggregates, cursors, sessions, cache, pooled requests, and RLS mutation detection. No buyer PII, competitor-private field, secret, or forbidden relation reaches results or telemetry. Exercise each tool kill switch and rollback before expansion. |
| **#33 admin reads** | Each admin tool accepts only its exact scope and current admin role; no buyer/seller, directory, export, payment, or mutation authority follows from admin status. Check approved fields and row/aggregate bounds in application, exception, return, promotion, platform, and revenue views. Exercise role downgrade, grant revocation, limited consent, dependency outages, canary PII, and direct legacy-route bypass. Validate staff monitoring and tool rollback. |
| **#34 drafts** | Every buyer, seller, and admin draft enforces live role/scope/grant/ownership, source allowlist, length, daily quota, and RLS. Repeated generation/persistence never sends messages, publishes listings, decides moderation, activates promotions, releases money, or changes commerce records. Exercise injection and encoded content, cross-owner draft access, provider failure, budget abuse, and PII/secret redaction. Prove draft flags, monitoring, cohort rollback, and proposal flags remaining off. |
| **#35 buyer proposals** | Forge chat confirmation, delegated execution, cross-user/grant references, target/payload substitution, replay, expiry, revocation, ownership change, and stale state: all deny. Browser review must show exact effects and require the human's authenticated confirmation. Concurrent confirmations yield one permitted mutation and deterministic repeat status; audit/outbox failure rolls back safely. Creating an abandoned proposal changes no commerce data; cancellation/return execution never initiates or releases payment/refund money. Validate cart cohort first, then cancellation and return independently. |
| **#36 seller proposals** | Deny cross-seller, unverified seller, substituted target, stale ownership, role change, invalid listing publication, unsafe decimal/price, stock race, and invalid fulfillment. Human browser execution applies exactly the reviewed bounded change once; MCP creates proposals but cannot execute. Check PII/secret redaction, atomic audit/outbox behavior, dependency outage, multi-replica replay, quotas, and rollback. Release listing content before independent price/inventory and fulfillment cohorts. |

## Executable #31 buyer gate

Run the generated registry matrix before any deployment or flag change:

```text
cd mcp
npm ci
npm run check
npm test
npm run buyer:matrix
```

`buyer:matrix` derives the ten #31 tools, flags, roles, and scopes from the live registry and fails if any static allow/deny case disagrees with the registry. Save its sanitized JSON output in the private release record.

Use `npm run buyer:validate` against the exact deployed artifact before enablement, after enablement, and after rollback:

1. With `MCP_BUYER_MODE=disabled`, prove the global switch or every buyer flag denies MCP discovery/dispatch and every direct Express route returns `404`.
2. Only after the release identity, approvals, thresholds, monitoring, rollback operator, synthetic fixtures, and credential scenarios are recorded, enable the approved buyer surface and run with `MCP_BUYER_MODE=enabled`.
3. Immediately restore the disabled configuration and rerun `MCP_BUYER_MODE=disabled` if any check fails. Do not start the observation window after a failed result.

The validator requires short-lived staging-only values through the process environment. Do not save them in `.env`, shell profiles, CI artifacts, the repository, or the public issue:

- MCP URL, optional Cloud Run identity token, exact client name `shopsphere-mcp-client`, exact version, and valid/wrong-role/wrong-scope/revoked/missing-account OAuth tokens.
- Backend URL, workload credential, optional Cloud Run identity token, and corresponding valid/wrong-role/wrong-scope/revoked/missing-account delegated tokens.
- Owned and foreign synthetic order IDs, a synthetic promo code, and a non-empty JSON array of canary PII/credential markers.

Required variable names for the enabled pass:

```text
MCP_BUYER_MODE
MCP_BUYER_URL
MCP_BUYER_CLIENT_NAME
MCP_BUYER_CLIENT_VERSION
MCP_BUYER_VALID_TOKEN
MCP_BUYER_ACCOUNT_SUBJECT
MCP_BUYER_WRONG_ROLE_TOKEN
MCP_BUYER_WRONG_SCOPE_TOKEN
MCP_BUYER_REVOKED_TOKEN
MCP_BUYER_MISSING_ACCOUNT_TOKEN
MCP_BUYER_BACKEND_URL
MCP_BUYER_BACKEND_WORKLOAD_TOKEN
MCP_BUYER_DELEGATED_VALID_TOKEN
MCP_BUYER_DELEGATED_WRONG_ROLE_TOKEN
MCP_BUYER_DELEGATED_WRONG_SCOPE_TOKEN
MCP_BUYER_DELEGATED_REVOKED_TOKEN
MCP_BUYER_DELEGATED_MISSING_ACCOUNT_TOKEN
MCP_BUYER_ORDER_ID
MCP_BUYER_FOREIGN_ORDER_ID
MCP_BUYER_PROMO_CODE
MCP_BUYER_FORBIDDEN_MARKERS
```

Set `MCP_BUYER_CLOUD_RUN_ID_TOKEN` and `MCP_BUYER_BACKEND_CLOUD_RUN_ID_TOKEN` when Cloud Run IAM protects those endpoints. The validator decodes the already server-verified valid JWT only to assert its `azp` is `shopsphere-mcp-client` and its ShopSphere subject matches `MCP_BUYER_ACCOUNT_SUBJECT`; neither value is written to evidence.

The wrong-role token must carry one role rejected by all ten buyer tools. The wrong-scope token must lack the required scope for all ten tools. Issue the valid, wrong-role, and wrong-scope credentials as three distinct short-lived grants for the same pilot account so the complete matrix cannot consume one grant's transport limit. The validator rejects narrower or shared-grant fixtures so shared profile/notification tools and buyer-only cart/order tools cannot silently receive partial matrix coverage.

The exact variable names are enforced by `mcp/scripts/validate-buyer-release.js`. Its only authoritative machine-readable record is the final line prefixed `SHOPSPHERE_BUYER_EVIDENCE=`. The record contains check names, outcomes, durations, statuses, and byte counts; it deliberately excludes tokens, fixture IDs, promo codes, response bodies, and canary values.

## Rollback and re-entry

Disable the affected per-tool flags and stop cohort admission immediately; use the global MCP switch if isolation is uncertain. Revoke affected grants/tokens and terminate private sessions. Expire pending proposals for affected cohorts, but preserve audits and committed commerce data. Verify disabled tools disappear from discovery, forged dispatch is denied, and normal storefront paths remain healthy. Record trigger, operator, UTC timestamps, changed flags/cohort, revocations, observed impact, request/audit links, and follow-up owner. Restore only after the affected gate is repeated and approved; do not treat a code revert as proof that data or previous execution was reversed.
