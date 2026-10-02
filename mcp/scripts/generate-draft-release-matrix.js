import { draftReleaseMatrixEvidence } from "../src/draftReleaseGate.js";
const evidence = draftReleaseMatrixEvidence();
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (evidence.registryOutcome !== "pass") process.exitCode = 1;
