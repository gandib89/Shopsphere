import { buyerReleaseMatrixEvidence } from "../src/buyerReleaseGate.js";

const evidence = buyerReleaseMatrixEvidence();
evidence.outcome = evidence.registryChecks.every(({ passed }) => passed) ? "pass" : "fail";
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (evidence.outcome !== "pass") process.exitCode = 1;
