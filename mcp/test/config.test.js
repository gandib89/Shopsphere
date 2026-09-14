import assert from "node:assert/strict";
import test from "node:test";

import { readConfig } from "../src/config.js";

test("MCP and every public tool fail closed by default", () => {
  const config = readConfig({});
  assert.equal(config.enabled, false);
  assert.ok(Object.values(config.flags).every((enabled) => enabled === false));
});
