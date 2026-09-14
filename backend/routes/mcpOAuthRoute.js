import express from "express";

import { getProtectedResourceMetadata } from "../utils/mcpOAuth.js";

const router = express.Router();

router.get("/.well-known/oauth-protected-resource", (req, res) => {
  const resource = typeof req.query.resource === "string" && req.query.resource
    ? req.query.resource
    : undefined;
  res.json(getProtectedResourceMetadata(resource));
});

export default router;
