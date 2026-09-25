// #16 acceptance criterion: "A promoted user gains no authority from an older
// narrower grant without renewed consent." The enforcement lives in
// validateAssistantAccess: the delegated token's scopes (fixed at consent
// time) gate every operation, and the token's identity claims are re-checked
// against the live account. These units pin both behaviors for the new admin
// reads without a database (the Prisma client is injected).
import assert from "node:assert/strict";
import test from "node:test";

import { readAssistantAccountCohort, validateAssistantAccess } from "./assistantDelegation.js";

const ADMIN = "eeeeeeeeeeeeeeeeeeeeeeee";
const USER = "aaaaaaaaaaaaaaaaaaaaaaaa";

const account = (overrides = {}) => ({
  id: USER,
  firstName: "Ada",
  lastName: "User",
  role: "user",
  isVerified: true,
  ...overrides,
});

test("an admin whose delegated grant lacks the new scope is denied despite the live admin role", async () => {
  // The user was promoted to admin in the database, but the standing consent
  // (and therefore the delegated token minted from it) never included
  // platform:read. Authority follows the consented grant, not the live role.
  let queried = false;
  const client = {
    user: { findUnique: async () => { queried = true; return account({ id: ADMIN, role: "admin" }); } },
  };
  const req = {
    delegation: {
      sub: ADMIN,
      role: "admin",
      verified: true,
      scopes: ["profile:read", "notifications:read"],
    },
  };
  const result = await validateAssistantAccess(req, { roles: ["admin"], scope: "platform:read" }, client);
  assert.deepEqual(result, { status: 403, code: "insufficient_scope" });
  assert.equal(queried, false);
});

test("the same grant still authorizes a scope the user actually consented to", async () => {
  const previous = process.env.MCP_ACCOUNT_COHORT;
  process.env.MCP_ACCOUNT_COHORT = ADMIN;
  const client = {
    user: { findUnique: async () => account({ id: ADMIN, role: "admin" }) },
  };
  const req = {
    delegation: {
      sub: ADMIN,
      role: "admin",
      verified: true,
      scopes: ["profile:read", "platform:read"],
    },
  };
  try {
    const result = await validateAssistantAccess(req, { roles: ["admin"], scope: "platform:read" }, client);
    assert.equal(result.status, undefined);
    assert.equal(result.account.role, "admin");
  } finally {
    if (previous === undefined) delete process.env.MCP_ACCOUNT_COHORT;
    else process.env.MCP_ACCOUNT_COHORT = previous;
  }
});

test("private assistant access defaults to an empty account cohort", async () => {
  const previous = process.env.MCP_ACCOUNT_COHORT;
  delete process.env.MCP_ACCOUNT_COHORT;
  const client = { user: { findUnique: async () => account() } };
  const req = { delegation: { sub: USER, role: "user", verified: true, scopes: ["profile:read"] } };
  try {
    assert.deepEqual(
      await validateAssistantAccess(req, { scope: "profile:read" }, client),
      { status: 403, code: "account_not_in_cohort" },
    );
  } finally {
    if (previous !== undefined) process.env.MCP_ACCOUNT_COHORT = previous;
  }
});

test("the account cohort parser trims, deduplicates, and drops empty entries", () => {
  assert.deepEqual(
    [...readAssistantAccountCohort({ MCP_ACCOUNT_COHORT: ` ${USER},,${ADMIN},${USER} ` })],
    [USER, ADMIN],
  );
});

test("a token claiming the admin role is denied when the live account role disagrees", async () => {
  const client = {
    user: { findUnique: async () => account() },
  };
  const req = {
    delegation: {
      sub: USER,
      role: "admin", // forged/stale claim: the DB still says plain user
      verified: true,
      scopes: ["platform:read", "sellers:read"],
    },
  };
  const result = await validateAssistantAccess(req, { roles: ["admin"], scope: "platform:read" }, client);
  assert.deepEqual(result, { status: 403, code: "stale_identity" });
});

test("the sellers:read scope is enforced identically for the application list", async () => {
  const client = {
    user: { findUnique: async () => account({ id: ADMIN, role: "admin" }) },
  };
  const req = {
    delegation: {
      sub: ADMIN,
      role: "admin",
      verified: true,
      scopes: ["platform:read"],
    },
  };
  const result = await validateAssistantAccess(req, { roles: ["admin"], scope: "sellers:read" }, client);
  assert.deepEqual(result, { status: 403, code: "insufficient_scope" });
});

test("a disabled rollout flag removes the operation before any scope check", async () => {
  const client = {
    user: { findUnique: async () => { throw new Error("must not be queried"); } },
  };
  const req = {
    delegation: {
      sub: ADMIN,
      role: "admin",
      verified: true,
      scopes: ["platform:read"],
    },
  };
  const previous = process.env.MCP_TOOL_GET_PLATFORM_REVENUE_SUMMARY_ENABLED;
  delete process.env.MCP_TOOL_GET_PLATFORM_REVENUE_SUMMARY_ENABLED;
  try {
    const result = await validateAssistantAccess(
      req,
      { roles: ["admin"], scope: "platform:read", rolloutFlag: "MCP_TOOL_GET_PLATFORM_REVENUE_SUMMARY_ENABLED" },
      client,
    );
    assert.deepEqual(result, { status: 404, code: "not_available" });
  } finally {
    if (previous !== undefined) process.env.MCP_TOOL_GET_PLATFORM_REVENUE_SUMMARY_ENABLED = previous;
  }
});
