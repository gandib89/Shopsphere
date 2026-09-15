import assert from "node:assert/strict";
import test from "node:test";

import { recordAssistantAudit, responseEvidence } from "./assistantAudit.js";

test("assistant audits retain exposure evidence without raw secret fields or response bodies", async () => {
  let saved;
  const client = { assistantAuditEvent: { create: async ({ data }) => { saved = data; return data; } } };
  const response = { notifications: [{ id: "n1", title: "private text" }], nextCursor: null };
  await recordAssistantAudit({
    traceId: "trace-1",
    operation: "notifications.listMine",
    outcome: "success",
    input: { cursor: "opaque", authorization: "Bearer raw", nested: { password: "raw" } },
    response,
    resourceIds: ["n1"],
    latencyMs: 12,
  }, client);
  assert.equal(saved.redactedInput.authorization, "[redacted]");
  assert.equal(saved.redactedInput.nested.password, "[redacted]");
  assert.equal(JSON.stringify(saved).includes("private text"), false);
  assert.deepEqual(saved.returnedFields, ["nextCursor", "notifications"]);
  assert.deepEqual(saved.resourceIds, ["n1"]);
  const evidence = responseEvidence(response);
  assert.equal(saved.responseDigest, evidence.responseDigest);
  assert.equal(saved.responseBytes, evidence.responseBytes);
});
