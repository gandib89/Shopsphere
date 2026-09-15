import crypto from "node:crypto";

import { prisma } from "../database/prismaClient.js";

const secretPattern = /authorization|token|secret|password|cookie|prompt|address|email|phone|cursor|session|cache/i;

const sanitize = (value, key = "") => {
  if (secretPattern.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitize(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)]),
    );
  }
  if (typeof value === "string") return value.slice(0, 500);
  return value;
};

const serialized = (value) => JSON.stringify(value ?? null);

export const responseEvidence = (response) => {
  const body = serialized(response);
  return {
    responseDigest: crypto.createHash("sha256").update(body).digest("base64url"),
    responseBytes: Buffer.byteLength(body),
    returnedFields: response && typeof response === "object" && !Array.isArray(response)
      ? Object.keys(response).sort()
      : [],
  };
};

export const recordAssistantAudit = async (event, client = prisma) => {
  const evidence = event.response === undefined ? {} : responseEvidence(event.response);
  return client.assistantAuditEvent.create({
    data: {
      id: crypto.randomUUID(),
      traceId: event.traceId || crypto.randomUUID(),
      layer: event.layer || "express",
      subjectId: event.subjectId || null,
      role: event.role || null,
      clientId: event.clientId || null,
      workloadId: event.workloadId || null,
      grantId: event.grantId || null,
      policyVersion: event.policyVersion || "1.0.0",
      tool: event.tool || null,
      operation: event.operation,
      authorizationOutcome: event.authorizationOutcome || "allowed",
      outcome: event.outcome,
      redactedInput: sanitize(event.input || {}),
      returnedFields: event.returnedFields || evidence.returnedFields || [],
      resourceIds: (event.resourceIds || []).slice(0, 50),
      responseDigest: event.responseDigest || evidence.responseDigest || null,
      responseBytes: event.responseBytes ?? evidence.responseBytes ?? null,
      rowCount: event.rowCount ?? null,
      latencyMs: Math.max(0, Math.trunc(event.latencyMs || 0)),
      failureReason: event.failureReason || null,
    },
  });
};

export const auditContext = (req, overrides = {}) => ({
  traceId: req.requestId,
  subjectId: req.delegation?.sub,
  role: req.delegation?.role,
  clientId: req.delegation?.clientId,
  workloadId: req.delegation?.workload,
  grantId: req.delegation?.grantId,
  ...overrides,
});
