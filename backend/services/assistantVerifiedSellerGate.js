// Verified-seller gate for #26 listing proposals.
//
// Listing proposals may only be created (and later executed) by a CURRENTLY
// VERIFIED seller. Verification is checked in BOTH places it can live, so a
// stale or forged claim alone is never enough:
//   1. the delegated token claim `shopsphere_verified` must be true, and
//   2. the live account row (loaded by authorizeAssistantOperation into
//      req.assistantAccount) must have isVerified = true.
// authorizeAssistantOperation already fails with 403 stale_identity whenever
// the claim and the live account disagree, so this gate adds the positive
// requirement: both must be true. Anything else answers the fixed
// 403 verification_required denial below.
//
// Like every other assistant denial this one is durably audited and fails
// closed: if the audit write itself fails, the request gets 503
// audit_unavailable instead of proceeding (same shape as the proposal rate
// limiter in assistantProposalLimits.js).
import { auditContext, recordAssistantAudit } from "./assistantAudit.js";

export const VERIFICATION_REQUIRED_STATUS = 403;
export const VERIFICATION_REQUIRED_CODE = "verification_required";
export const VERIFICATION_REQUIRED_MESSAGE = "Seller verification is required";

export const isVerifiedSellerPrincipal = (req) =>
  req?.delegation?.verified === true && req?.assistantAccount?.isVerified === true;

export const requireVerifiedSeller = ({
  operation = "proposals.verifiedSeller",
  audit = recordAssistantAudit,
  context = auditContext,
} = {}) => async (req, res, next) => {
  if (isVerifiedSellerPrincipal(req)) return next();
  const respond = async () => {
    if (!req.requestId) {
      return res.status(VERIFICATION_REQUIRED_STATUS).json({
        code: VERIFICATION_REQUIRED_CODE,
        message: VERIFICATION_REQUIRED_MESSAGE,
      });
    }
    try {
      await audit(context(req, {
        operation,
        authorizationOutcome: "denied",
        outcome: VERIFICATION_REQUIRED_CODE,
        failureReason: VERIFICATION_REQUIRED_CODE,
        latencyMs: 0,
      }));
    } catch {
      return res.status(503).json({ code: "audit_unavailable", message: "Audit service is unavailable" });
    }
    return res.status(VERIFICATION_REQUIRED_STATUS).json({
      code: VERIFICATION_REQUIRED_CODE,
      message: VERIFICATION_REQUIRED_MESSAGE,
    });
  };
  return respond();
};
