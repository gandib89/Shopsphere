import { isDelegatedTokenShape, verifyDelegatedToken } from "../utils/mcpOAuth.js";

const bearer = (req) => {
  const header = req.headers?.authorization ?? req.get?.("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
};

// Verifies the audience-separated delegated token family only. Never falls
// back to the legacy browser JWT: a delegated failure is a denial, and a
// browser/MCP-audience token here is a denial too.
export const authenticateAssistantDelegation = async (req, res, next, verify = verifyDelegatedToken) => {
  const token = bearer(req);
  if (!token) {
    return res.status(401).json({ code: "invalid_token", message: "No delegated token provided" });
  }
  try {
    const claims = await verify(token);
    req.delegation = {
      sub: claims.sub,
      clientId: claims.client_id,
      grantId: claims.grant_id,
      scopes: claims.scopes,
      role: claims.role,
      workload: claims.azp,
    };
    return next();
  } catch (error) {
    const status = error?.status === 403 ? 403 : 401;
    return res.status(status).json({ code: error?.code ?? "invalid_token", message: "Invalid delegated credential" });
  }
};

// Global-restriction seam (wired to non-assistant routes in a later phase):
// a valid delegated token is never valid outside /api/v1/assistant/*.
export const rejectDelegatedTokens = async (req, res, next, verify = verifyDelegatedToken) => {
  const token = bearer(req);
  if (!token || !isDelegatedTokenShape(token)) return next();
  try {
    await verify(token);
  } catch {
    // Token-like delegated credentials fail closed on non-assistant routes too.
  }
  return res.status(403).json({ code: "delegated_not_allowed", message: "Delegated tokens are assistant-only" });
};
