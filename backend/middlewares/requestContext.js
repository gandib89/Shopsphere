import crypto from "crypto";
import { logger } from "../utils/logger.js";

// Assigns a correlation id to every request (reusing an inbound X-Request-Id from a proxy/LB
// when present) and logs one structured line per request on completion — the minimum needed to
// answer "what happened to request X" without a full APM tier.
export const requestContext = (req, res, next) => {
  const supplied = req.headers["x-request-id"];
  const requestId = typeof supplied === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
  req.requestId = requestId;
  const abortController = new AbortController();
  req.assistantSignal = abortController.signal;
  res.setHeader("X-Request-Id", requestId);

  const startedAt = Date.now();
  res.on("finish", () => {
    logger.info("request", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.user?.id,
    });
  });
  res.on("close", () => {
    if (!res.writableFinished) abortController.abort();
  });

  next();
};
