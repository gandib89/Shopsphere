import { auditContext, recordAssistantAudit } from "../services/assistantAudit.js";

// Parser errors can contain the submitted body in both body and message. Only
// stable classifications reach the audit sink or public response.
export const createAssistantParserErrorHandler = (recordAudit = recordAssistantAudit) =>
  async (error, req, res, next) => {
    const failureReason = error.type === "entity.too.large"
      ? "request_too_large"
      : error.type === "entity.parse.failed" ? "invalid_json" : null;
    if (!failureReason) return next(error);

    try {
      await recordAudit(auditContext(req, {
        operation: "transport.request",
        authorizationOutcome: "denied",
        outcome: "request_rejected",
        failureReason,
        input: {},
      }));
    } catch {
      return res.status(503).json({
        success: false, code: "audit_unavailable", message: "Audit service unavailable",
        requestId: req.requestId,
      });
    }
    return res.status(failureReason === "request_too_large" ? 413 : 400).json({
      success: false,
      code: failureReason,
      message: failureReason === "request_too_large" ? "Request body is too large" : "Invalid JSON request body",
      requestId: req.requestId,
    });
  };

export const assistantParserErrorHandler = createAssistantParserErrorHandler();
