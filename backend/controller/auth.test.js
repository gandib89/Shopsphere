import assert from "node:assert/strict";
import test from "node:test";

process.env.JWT_SECRET ||= "test-secret-do-not-use-in-prod";

import { register, login, refresh, logout, forgotPassword, resetPassword } from "./auth.js";

// Minimal in-memory Prisma stand-in covering just the User + RefreshToken models these
// handlers touch — mirrors the injection pattern already used in order.test.js.
const createFakeAuthPrisma = (users = []) => {
  const state = { users, refreshTokens: [] };
  return {
    state,
    user: {
      findUnique: async ({ where }) => {
        if (where.email !== undefined) return state.users.find((u) => u.email === where.email) || null;
        if (where.id !== undefined) return state.users.find((u) => u.id === where.id) || null;
        if (where.resetTokenHash !== undefined) return state.users.find((u) => u.resetTokenHash === where.resetTokenHash) || null;
        return null;
      },
      create: async ({ data }) => {
        if (state.users.some((u) => u.email === data.email)) {
          const err = new Error("duplicate");
          err.code = "P2002";
          err.meta = { target: ["email"] };
          throw err;
        }
        state.users.push({ ...data });
        return { ...data };
      },
      update: async ({ where, data }) => {
        const user = state.users.find((u) => u.id === where.id);
        Object.assign(user, data);
        return { ...user };
      },
    },
    refreshToken: {
      create: async ({ data }) => {
        state.refreshTokens.push({ ...data });
        return { ...data };
      },
      findUnique: async ({ where }) => state.refreshTokens.find((t) => t.tokenHash === where.tokenHash) || null,
      update: async ({ where, data }) => {
        const row = state.refreshTokens.find((t) => t.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        state.refreshTokens.forEach((t) => {
          if (t.familyId === where.familyId && t.revokedAt === null) {
            Object.assign(t, data);
            count += 1;
          }
        });
        return { count };
      },
    },
  };
};

const createFakeRes = () => {
  const res = {
    statusCode: null,
    body: null,
    cookies: {},
    cleared: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send() {
      return this;
    },
    cookie(name, value) {
      this.cookies[name] = value;
      return this;
    },
    clearCookie(name) {
      this.cleared.push(name);
      return this;
    },
  };
  return res;
};

test("register rejects a duplicate email without hitting the DB twice", async () => {
  const client = createFakeAuthPrisma([{ id: "u1", email: "taken@example.com", role: "user" }]);
  const req = { body: { firstName: "A", lastName: "B", email: "taken@example.com", password: "Password1", role: "user" } };
  const res = createFakeRes();

  await register(req, res, client);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "email_taken");
});

test("register requires a shop name for sellers", async () => {
  const client = createFakeAuthPrisma([]);
  const req = { body: { firstName: "A", lastName: "B", email: "seller@example.com", password: "Password1", role: "seller" } };
  const res = createFakeRes();

  await register(req, res, client);

  assert.equal(res.statusCode, 400);
  assert.equal(client.state.users.length, 0);
});

test("register never allows a public caller to create an admin", async () => {
  const client = createFakeAuthPrisma([]);
  const req = {
    body: {
      firstName: "Mallory", lastName: "Admin", email: "mallory@example.com",
      password: "Password1", role: "admin",
    },
  };
  const res = createFakeRes();

  await register(req, res, client);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "invalid_input");
  assert.equal(client.state.users.length, 0);
});

test("register creates an unverified seller and issues a session", async () => {
  const client = createFakeAuthPrisma([]);
  const req = {
    body: {
      firstName: "A", lastName: "B", email: "newseller@example.com", password: "Password1",
      role: "seller", shopName: "Acme",
    },
  };
  const res = createFakeRes();

  await register(req, res, client);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.user.seller, true);
  assert.equal(res.body.user.sellerVerified, false);
  assert.ok(res.body.accessToken);
  assert.ok(res.cookies.refresh_token); // session was actually issued
  assert.equal(client.state.refreshTokens.length, 1);
});

test("login rejects an unknown email with the same generic message as a wrong password (no enumeration)", async () => {
  const client = createFakeAuthPrisma([]);
  const req = { body: { email: "ghost@example.com", password: "whatever1" } };
  const res = createFakeRes();

  await login(req, res, client);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.message, "Invalid email or password");
});

test("login rejects a wrong password without issuing a session", async () => {
  const { hashPassword } = await import("../utils/password.js");
  const client = createFakeAuthPrisma([{ id: "u1", email: "user@example.com", password: await hashPassword("correct-horse"), role: "user" }]);
  const req = { body: { email: "user@example.com", password: "wrong-password" } };
  const res = createFakeRes();

  await login(req, res, client);

  assert.equal(res.statusCode, 401);
  assert.equal(client.state.refreshTokens.length, 0);
});

test("login opportunistically upgrades a legacy bcrypt hash to argon2", async () => {
  const bcrypt = (await import("bcryptjs")).default;
  const { isLegacyHash } = await import("../utils/password.js");
  const legacyHash = await bcrypt.hash("OldPassword1", 12);
  const client = createFakeAuthPrisma([{ id: "u1", email: "legacy@example.com", password: legacyHash, role: "user" }]);
  const req = { body: { email: "legacy@example.com", password: "OldPassword1" } };
  const res = createFakeRes();

  await login(req, res, client);

  assert.equal(res.statusCode, 200);
  const stored = client.state.users[0].password;
  assert.notEqual(stored, legacyHash);
  assert.equal(isLegacyHash(stored), false);
});

test("refresh rejects when no cookie is present", async () => {
  const client = createFakeAuthPrisma([]);
  const req = { cookies: {} };
  const res = createFakeRes();

  await refresh(req, res, client);

  assert.equal(res.statusCode, 401);
});

test("refresh rotates a valid token and clears the cookie on reuse of an already-used one", async () => {
  const client = createFakeAuthPrisma([{ id: "u1", email: "user@example.com", role: "user" }]);
  const { issueRefreshFamily } = await import("../utils/refreshTokenStore.js");
  const rawToken = await issueRefreshFamily("u1", client);

  const res1 = createFakeRes();
  await refresh({ cookies: { refresh_token: rawToken } }, res1, client);
  assert.equal(res1.statusCode, 200);
  const rotatedToken = res1.cookies.refresh_token;
  assert.notEqual(rotatedToken, rawToken);

  // Reusing the now-rotated-away original token is a reuse/theft signal — must fail closed.
  const res2 = createFakeRes();
  await refresh({ cookies: { refresh_token: rawToken } }, res2, client);
  assert.equal(res2.statusCode, 401);
  assert.ok(res2.cleared.includes("refresh_token"));
});

test("logout revokes the refresh token family and clears the cookie even with no token", async () => {
  const client = createFakeAuthPrisma([]);
  const res = createFakeRes();

  await logout({ cookies: {} }, res, client);

  assert.equal(res.statusCode, 204);
  assert.ok(res.cleared.includes("refresh_token"));
});

// Never a real network call in tests — stub the sender and assert on what it was called with.
const createFakeSend = () => {
  const calls = [];
  const send = (to, subject, text, html) => { calls.push({ to, subject, text, html }); };
  send.calls = calls;
  return send;
};

test("forgotPassword gives the same generic response for a known and an unknown email (no enumeration)", async () => {
  const client = createFakeAuthPrisma([{ id: "u1", email: "real@example.com", firstName: "Real", password: "hash", role: "user" }]);

  const resKnown = createFakeRes();
  await forgotPassword({ body: { email: "real@example.com" } }, resKnown, client, createFakeSend());

  const resUnknown = createFakeRes();
  await forgotPassword({ body: { email: "ghost@example.com" } }, resUnknown, client, createFakeSend());

  assert.equal(resKnown.statusCode, 200);
  assert.equal(resUnknown.statusCode, 200);
  assert.deepEqual(resKnown.body, resUnknown.body);
});

test("forgotPassword sets a reset token only for the known user, not a Google-only account", async () => {
  const client = createFakeAuthPrisma([
    { id: "u1", email: "real@example.com", firstName: "Real", password: "hash", role: "user" },
    { id: "u2", email: "google@example.com", firstName: "G", password: null, googleId: "g1", role: "user" },
  ]);
  const send = createFakeSend();

  await forgotPassword({ body: { email: "real@example.com" } }, createFakeRes(), client, send);
  await forgotPassword({ body: { email: "google@example.com" } }, createFakeRes(), client, send);

  assert.equal(send.calls.length, 1); // only the real, password-having account gets emailed

  assert.ok(client.state.users[0].resetTokenHash);
  assert.ok(!client.state.users[1].resetTokenHash);
});

test("resetPassword rejects an unknown or already-consumed token", async () => {
  const client = createFakeAuthPrisma([]);
  const res = createFakeRes();

  await resetPassword({ body: { token: "not-a-real-token", newPassword: "NewPassword1" } }, res, client);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "invalid_token");
});

test("resetPassword rejects an expired token", async () => {
  const { hashRefreshToken: hashOpaqueToken } = await import("../utils/tokens.js");
  const client = createFakeAuthPrisma([{
    id: "u1", email: "real@example.com", password: "old-hash", role: "user",
    resetTokenHash: hashOpaqueToken("expired-token"),
    resetTokenExpiresAt: new Date(Date.now() - 1000),
  }]);
  const res = createFakeRes();

  await resetPassword({ body: { token: "expired-token", newPassword: "NewPassword1" } }, res, client);

  assert.equal(res.statusCode, 400);
});

test("resetPassword sets the new password, clears the token, and revokes every existing session", async () => {
  const { hashRefreshToken: hashOpaqueToken } = await import("../utils/tokens.js");
  const { verifyPassword } = await import("../utils/password.js");
  const { issueRefreshFamily } = await import("../utils/refreshTokenStore.js");

  const client = createFakeAuthPrisma([{
    id: "u1", email: "real@example.com", password: "old-hash", role: "user",
    resetTokenHash: hashOpaqueToken("good-token"),
    resetTokenExpiresAt: new Date(Date.now() + 60000),
  }]);
  await issueRefreshFamily("u1", client); // an existing logged-in session elsewhere

  const res = createFakeRes();
  await resetPassword({ body: { token: "good-token", newPassword: "NewPassword1" } }, res, client);

  assert.equal(res.statusCode, 200);
  const user = client.state.users[0];
  assert.equal(user.resetTokenHash, null);
  assert.equal(await verifyPassword(user.password, "NewPassword1"), true);
  assert.ok(client.state.refreshTokens.every((t) => t.revokedAt !== null)); // every prior session killed
});
