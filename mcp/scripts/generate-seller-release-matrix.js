import { sellerReleaseMatrixEvidence } from "../src/sellerReleaseGate.js";

let proofs = {};
if (process.env.MCP_SELLER_MATRIX_PROOFS) {
  try { proofs = JSON.parse(process.env.MCP_SELLER_MATRIX_PROOFS); }
  catch { throw new Error("MCP_SELLER_MATRIX_PROOFS must be JSON"); }
  if (!proofs || typeof proofs !== "object" || Array.isArray(proofs)) {
    throw new Error("MCP_SELLER_MATRIX_PROOFS must be an object");
  }
}
const evidence = sellerReleaseMatrixEvidence(proofs);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (evidence.registryOutcome !== "pass"
  || (process.env.MCP_SELLER_MATRIX_FINAL === "true" && evidence.outcome !== "pass")) process.exitCode = 1;
