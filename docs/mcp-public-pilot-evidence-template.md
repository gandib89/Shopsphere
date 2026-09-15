# MCP public pilot evidence record

Copy this file to the organization's private release-evidence system. Do not commit completed records containing environment details, customer data, tokens, or internal dashboard links to the public repository.

## Release identity

| Field | Value |
|---|---|
| Environment | |
| Release commit SHA | |
| Image/artifact digest | |
| Registry version | |
| Protocol version | `2025-11-25` |
| Release operator | |
| Rollback operator | |
| Start/end UTC | |
| Planned cohort/client IDs | |
| Observation window | |
| Monitoring/dashboard links | |

## Supported-client interoperability

Add one row per intended client and exact version. Attach evidence produced by that client; the SDK harness is its own client and is not a substitute.

| Client ID/name | Exact version | Initialization evidence | Discovery evidence | Seven public calls evidence | Result/owner |
|---|---|---|---|---|---|
| | | | | | |

## Security, bounds, and operations

| Scenario | UTC | Synthetic fixture/profile | Request/audit trace IDs | Expected result | Evidence link | Result/owner |
|---|---|---|---|---|---|---|
| Injection and forged call | | | | | | |
| Arbitrary fetch and unknown fields | | | | | | |
| Archived/private visibility | | | | | | |
| Request and response sizes | | | | | | |
| Rate limit | | | | | | |
| Concurrency limit | | | | | | |
| Approved load profile | | | | | | |
| Audit delivery and redaction | | | | | | |
| Every per-tool flag | | | | | | |
| Global kill switch/storefront independence | | | | | | |
| Backend dependency degradation | | | | | | |

## Go/no-go approvals

| Approval/condition | Approver or evidence link | UTC | Result |
|---|---|---|---|
| Repository test suites pass on release SHA | | | |
| No unresolved critical/high findings | | | |
| Product approval | | | |
| Security approval | | | |
| Operations approval and rollback coverage | | | |
| Cohort allowlist reviewed | | | |

Decision: **NO-GO until every required row above is complete.**

Final decision, approver, UTC, and rationale:

## Rollback exercise or incident

| Field | Value |
|---|---|
| Trigger | |
| Start/end UTC | |
| Operator | |
| Affected tools/cohort | |
| Flag/global-switch changes | |
| Client/grant revocations | |
| MCP denial verification | |
| Storefront availability verification | |
| Audit preservation verification | |
| Customer impact | |
| Follow-up owner/issues | |

Re-enable decision, approver, UTC, and evidence:
