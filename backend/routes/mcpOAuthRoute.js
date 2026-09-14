import express from "express";

import {
  ASSISTANT_AUDIENCE,
  DELEGATED_TOKEN_TTL_SEC,
  OAUTH_ISSUER,
  OAuthError,
  exchangeForDelegatedToken,
  getAuthorizationServerMetadata,
  getProtectedResourceMetadata,
  verifyDelegatedToken,
} from "../utils/mcpOAuth.js";

const router = express.Router();

router.get("/.well-known/oauth-protected-resource", (req, res) => {
  const resource = typeof req.query.resource === "string" && req.query.resource ? req.query.resource : undefined;
  res.json(getProtectedResourceMetadata(resource));
});

router.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json(getAuthorizationServerMetadata());
});

// RFC 8693-style exchange. Form posts and JSON both work; the app already
// parses both bodies. Scope narrowing only; audience fixed to the assistant
// API. Error codes are deterministic per failure class.
router.post("/api/v1/oauth/token", (req, res) => {
  try {
    const body = req.body ?? {};
    if (body.grant_type !== "urn:ietf:params:oauth:grant-type:token-exchange") {
      throw new OAuthError("unsupported_grant_type", "Only the token-exchange grant is supported", 400);
    }
    const subjectToken = body.subject_token;
    if (!subjectToken) throw new OAuthError("invalid_grant", "Subject token is required", 400);
    const clientId = body.client_id;
    const accessToken = exchangeForDelegatedToken({
      subjectToken,
      workloadId: body.workload_id,
      scopes: typeof body.scope === "string" && body.scope ? body.scope.split(" ") : null,
      audience: body.audience ?? body.resource ?? ASSISTANT_AUDIENCE,
    });
    if (clientId && verifyDelegatedToken(accessToken).client_id !== clientId) {
      throw new OAuthError("invalid_grant", "Client mismatch", 400);
    }
    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: DELEGATED_TOKEN_TTL_SEC,
      audience: ASSISTANT_AUDIENCE,
      issuer: OAUTH_ISSUER,
    });
  } catch (error) {
    const status = error instanceof OAuthError ? error.status : 400;
    res.status(status).json({ error: error?.code ?? "invalid_request" });
  }
});

export default router;
