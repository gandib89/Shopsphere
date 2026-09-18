// Verified-seller gate for #27 price proposals (assistant surface).
//
// DESIGN DECISION (one enforcement point, documented): seller verification for
// propose_price_change is enforced HERE — as a route-scoped middleware in the
// privateOperation `middlewares` slot, i.e. strictly after delegated-token
// authorization — and NOT again inside the proposal service. authorizeAssistantOperation
// has just loaded the live account row (validateAssistantAccess selects
// isVerified from the database and cross-checks it against the token's
// shopsphere_verified claim), so this gate reads req.assistantAccount.isVerified
// with no extra query: an unverified (or freshly un-verified) seller can never
// reach the service. The gate is deliberately self-contained — a parallel
// ticket ships its own similarly-named verification gate, and the two must not
// share state or drift together.
//
// Failure is a 403 verification_required, durably audited like every other
// assistant denial (audit write failure degrades to 503 audit_unavailable —
// fail closed, never an unaudited pass).
import { auditContext, recordAssistantAudit } from "./assistantAudit.js";

export const requireVerifiedSeller = ({
  operation = "proposals.priceChange",
  audit = recordAssistantAudit,
} = {}) => async (req, res, next) => {
  if (req.assistantAccount?.isVerified) return next();
  if (req.requestId) {
    try {
      await audit(auditContext(req, {
        operation,
        authorizationOutcome: "denied",
        outcome: "verification_required",
        failureReason: "verification_required",
        latencyMs: 0,
      }));
    } catch {
      return res.status(503).json({ code: "audit_unavailable", message: "Audit service is unavailable" });
    }
  }
  return res.status(403).json({
    code: "verification_required",
    message: "Seller verification is required for this operation",
  });
};
