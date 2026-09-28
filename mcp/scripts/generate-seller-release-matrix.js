import { sellerReleaseMatrixEvidence } from "../src/sellerReleaseGate.js";

const evidence = sellerReleaseMatrixEvidence();
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (evidence.outcome !== "pass") process.exitCode = 1;
