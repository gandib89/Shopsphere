# Solo-owned MCP demo release scope

The project owner, `gandib89`, clarified on 2026-09-30 that ShopSphere is a solo project and the MCP server is a synthetic demo. The owner requested this scope in every remaining issue: #1 and #32–#36. Those issue bodies contain the governing owner-approved scope.

## Approval and technical evidence

One accountable owner covers security, privacy/data processing and audit retention, product/domain, and operations/rollback decisions. Record the owner's approval once, with its date, scope, and evidence, then reference it for the applicable roles. Separate organizational approvers are not required. Do not repeatedly request approval already given within the same scope.

Technical gates still require genuine proof. Keep authorization, role/scope/grant/ownership isolation, restricted database access and RLS, bounded projections, privacy, limits, durable auditing, applicable monitoring, dependency failures, observation, and rollback requirements. General approval does not turn an untested check into a pass or automatically accept an unresolved finding.

An explicit owner decision may accept a documented limitation for the synthetic demo. Record the decision and rationale as an accepted exception or waiver, not a successful test. Apply the issue's demo scope when a generic production or organizational approval template conflicts with it. Preserve phase dependencies and independent feature flags.

## Boundaries

Demo completion does not authorize production changes, real-user onboarding, wider cohorts, real money movement, or a compliance claim. Use synthetic staging fixtures and approved clients. Preserve unrelated workspace changes, commerce data, database volumes, and historical audit evidence. Keep sensitive evidence private and public updates sanitized.

After a controlled gate, restore the baseline cohort, revoke temporary grants, remove temporary users and fault objects, switch flags off, and stop staging compute. If automatic approval review rejects cleanup, report the action, reason, and exact outstanding files; do not bypass the rejection.

## Completed seller-read demo gate

[Issue #32](https://github.com/gandib89/Shopsphere/issues/32) was closed on 2026-09-30 for the controlled synthetic seller-read demo. Its [private release record](https://storage.cloud.google.com/shopsphere-mcp-stage-260923_cloudbuild/release-evidence/issue-32/2026-09-30/rerun/complete-release-record.json) preserves the exact deployed SHA and image provenance, hosted tests, distinct initial/final disabled proofs, observation, rollback, owner decisions, failed trials, and subsequent corrections.

- The final matrix passed 42 registry checks and six runtime proof groups. Hosted limits and dependency failures, PostgreSQL ownership/history/RLS, Redis session isolation, observation, and rollback have genuine linked evidence.
- The owner explicitly accepted manual monitoring and rollback instead of automatic alert messages for this demo. External alert delivery is waived and untested, not passed.
- The owner explicitly accepted restricted retention of previously disclosed synthetic identifiers after the logging fixes. Historical failed privacy/routing probes remain preserved; they are not retroactively labeled successful.
- Daily draft/proposal quotas do not apply to these six read tools; their distributed per-minute and concurrency limits were tested. Later phases retain their own applicable budgets.
- The completion record proves disabled runtime and a stopped staging VM. Grant/user cleanup and unchanged commerce data are backed by the recorded cleanup proofs; later live checks did not claim new database checks while the VM was stopped.
- Local private-file deletion was rejected with `blocked by policy`. The private record and cleanup manifest report the outstanding manual removal. No alternate deletion mechanism was attempted.

These #32 exceptions do not automatically waive requirements for #33–#36. Unattended operation or any real-user release requires a fresh decision and the applicable technical evidence.
