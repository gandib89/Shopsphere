# MCP public pilot release gate

This runbook is the release and rollback evidence gate for issue #30. The public MCP tools remain disabled until every required row below has evidence from the target staging environment. Repository tests and an SDK smoke run are useful evidence, but they do not prove that a named desktop or web client interoperates, that staging controls were exercised, or that a release was approved.

## Fixed pilot contract

- Protocol: `2025-11-25`.
- Server and client SDK packages: `@modelcontextprotocol/*` `2.0.0` as pinned in `mcp/package-lock.json`.
- Public tools: `get_capabilities`, `get_store_policy`, `search_products`, `compare_products`, `get_product`, `get_product_reviews`, and `get_recommendations`.
- Request body: at most 32 KiB. Serialized response: at most 64 KiB.
- Search/review pages: 20 by default and 50 maximum. Comparisons: 5 products maximum. Recommendations: 20 maximum.
- Global switch and every public tool flag default to disabled.
- The first cohort is the exact allowlist in `MCP_OAUTH_CLIENTS`. Widening that list is a release change and requires this gate again.

## Evidence directory

Create a private release record outside the source repository from [the evidence template](mcp-public-pilot-evidence-template.md). Store sanitized command output, screenshots, dashboards, approvals, and incident links with it. Do not store access tokens, customer data, raw review text, full MCP responses, database URLs, or other secrets.

Record the deployed commit SHA, image digest, environment, operator, UTC timestamps, approved client ID/version, policy/registry version, and links to immutable evidence. A checkbox without a link or attached artifact is not evidence.

## Before starting staging validation

Record the staging MCP URL and exact deployed artifact, approved first-party client IDs and versions, synthetic catalog fixtures, private evidence location, monitoring links and thresholds, and named release and rollback operators. Confirm the issuer, assistant backend, Redis, and durable audit sink are connected to this staging deployment. Keep all public flags disabled until the corresponding checks are ready to run. If any prerequisite is missing, record a no-go decision; a local fixture or storefront health check cannot stand in for the staging MCP service.

## Automated preflight

Run both package suites against the exact release commit:

Use a throwaway `JWT_SECRET` value for the backend tests, as the CI job does. Do not use a deployed signing secret in local validation.

```text
cd mcp
npm ci
npm run check
npm test

cd ../backend
npm ci
npx prisma generate
npm test
```

Run the smoke harness once per approved client/version identity against staging. Provide secrets only through the process environment. The JSON output deliberately excludes the token and response bodies; attach it to the private release record.

```text
MCP_PILOT_URL=https://staging.example/mcp
MCP_PILOT_ACCESS_TOKEN=<short-lived staging token>
MCP_PILOT_CLIENT_NAME=<approved client identifier>
MCP_PILOT_CLIENT_VERSION=<exact version>
npm run pilot:validate
```

This harness proves the pinned SDK path. For an actual desktop or web client, separately capture that client's initialization, discovery, and all seven calls. Do not relabel a harness run as evidence from another client.

## Required staging checks

Use synthetic public fixtures only. Correlate every scenario to sanitized audit records by `x-request-id`.

| Gate | Required observation |
|---|---|
| Client interoperability | Every intended client/version negotiates `2025-11-25`, discovers exactly the enabled public allowlist, and invokes all seven tools successfully. |
| Injection resistance | Prompt-like text in search terms, policy/review content, product text, and client metadata neither adds tools nor changes fixed backend destinations. Direct forged tool calls are denied. |
| Arbitrary fetch and strict inputs | URL, method, header, Prisma-style filter/include/select, owner/role, SQL-like, and unknown fields are rejected; no outbound request to supplied data occurs. |
| Visibility | Archived/private products never appear as parents, comparisons, review parents, or recommendations. Unknown and hidden IDs do not become an existence oracle. |
| Bounds | Oversized declared and chunked bodies are rejected early; page/comparison limits reject overflow; every serialized response remains at or below 64 KiB. |
| Rate and concurrency | The configured per-identity rate produces bounded `429` with `Retry-After`; concurrency saturation produces bounded `503` while admitted work completes. |
| Load | The approved load profile meets recorded latency/error thresholds without bypassing response, rate, concurrency, or backend time limits. Record the profile and thresholds before running it. |
| Auditing | Success, tool failure, authentication denial, origin denial, rate denial, concurrency denial, and kill-switch denial have traceable metadata and stable reasons; logs contain no raw credentials or response content. |
| Tool rollback | Disable each public tool flag in turn. It disappears from discovery and forged dispatch is denied. Re-enable only after the check is recorded. |
| Global rollback | Set `MCP_ENABLED=false`. `/mcp` returns bounded `503`, `/health` remains live, and the independent storefront health and shopping path remain available. |
| Public degradation | Make the assistant backend unavailable in staging. Public calls return sanitized bounded tool errors, audit the failure, and never disclose dependency addresses or credentials; storefront health remains available. |

## Go/no-go and cohort widening

Release only when all rows are complete, there are no unresolved critical/high findings, the rollback operator is named and available, monitoring links and thresholds are recorded, and the product/security/operations approvals required by the organization are attached. Start with only the approved first-party client IDs already recorded in the evidence.

Before adding any client ID or increasing traffic, review error rate, latency, rate/concurrency denials, response sizes, visibility-denial outcomes, and audit delivery for the observation window recorded in the evidence. Any missing evidence is a no-go.

## Rollback

1. Disable the affected `MCP_TOOL_*_ENABLED` flags. If the risk is not isolated, set `MCP_ENABLED=false`.
2. Remove newly admitted client IDs from `MCP_OAUTH_CLIENTS` and revoke affected grants/tokens at the issuer.
3. Confirm `/mcp` is denied as expected and the storefront remains healthy.
4. Preserve audits and already committed storefront data. Do not delete evidence to make a retry look clean.
5. Record start/end UTC timestamps, operator, trigger, affected cohort, flag/config changes, issuer revocations, verification links, customer impact, and follow-up owner.
6. Re-enable only through a new completed release gate.

Issue #30 still requires real staging execution, named-client evidence, organizational approvals, and cohort observation. Those items cannot be satisfied by repository changes alone.
