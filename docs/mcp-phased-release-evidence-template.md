# MCP phase release evidence record

Copy into a **private** release-evidence system for issue #31, #32, #33, #34, #35, or #36. Make a separate record for each #35/#36 proposal cohort. Leave the decision **NO-GO** until every applicable row has a linked artifact and approval. See the [runbook](mcp-phased-release-runbook.md) for exact observations. Do not commit a filled record with sensitive data.

## Release identity and dependencies

| Field | Value or immutable evidence link |
|---|---|
| Issue and cohort (cart/cancellation/return/listing/price/inventory/fulfillment if applicable) | |
| Blocking issue release-record links, including #30 where required | |
| Staging environment, deployed commit SHA, image digest, registry/policy version | |
| Protocol; exact enabled tools, scopes, flag values | |
| Approved client IDs and exact versions; selected role/account allowlist | |
| Synthetic fixture version; database/migration/forward-repair evidence | |
| Release operator, rollback operator, UTC window | |
| Predeclared load profile, success thresholds, monitoring links, observation window | |

## Evidence matrix

Each row needs expected and actual results, sanitized request/audit IDs, UTC time, artifact link, and reviewer. Add rows for every tool and role/scope/owner case, not one example for the whole phase.

| Scenario | Tool and fixture | Expected / actual | Request and audit IDs | UTC / evidence link / reviewer |
|---|---|---|---|---|
| Release-SHA MCP/backend/frontend suites; generated authorization matrix | | | | |
| Intended client initialization, discovery, and calls in staging | | | | |
| MCP and direct Express denial matrix; legacy-route bypass | | | | |
| PostgreSQL 16 ownership/RLS, nested fields, cursors, cache, sessions, pool/failure cleanup | | | | |
| Projection bounds and canary PII/secret checks across output, error, audit, log, trace | | | | |
| Repeated-read or draft/proposal non-execution and commerce side-effect check | | | | |
| Phase-specific adversarial and race cases from runbook | | | | |
| Rate, daily quota, concurrency, response size, and approved load profile | | | | |
| Dependency outage, durable audit/outbox failure, alerts | | | | |
| Each tool flag: discovery and forged dispatch denied | | | | |
| Global kill switch and storefront availability | | | | |
| Human browser review, exact-value execution, replay and status (proposals only) | | | | |

## Approval and cohort observation

| Decision | Named approver / UTC / evidence link / result |
|---|---|
| Security and no unresolved critical/high findings | |
| Privacy, external-client data processing, and audit retention | |
| Product/domain owner and human-execution policy (if applicable) | |
| Operations, monitoring, and available rollback operator | |
| Initial client/account allowlist and per-tool flags | |
| Observation window results before each cohort expansion | |

Final decision: **NO-GO** until required evidence and approvals are complete. Record GO/NO-GO, approver, UTC, and rationale here:

## Rollback exercise or incident

| Field | Value or evidence link |
|---|---|
| Trigger, operator, start/end UTC | |
| Affected tools, accounts, client IDs, and observed impact | |
| Flag/global-switch changes; grant/token revocations; session termination | |
| Pending proposal expiry and committed-data disposition (if applicable) | |
| Discovery/forged-dispatch denial and storefront health verification | |
| Audit preservation and follow-up owner/issues | |
| Re-entry gate, new approval, UTC | |
