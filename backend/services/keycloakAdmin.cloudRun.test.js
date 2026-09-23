import assert from "node:assert/strict";
import test from "node:test";

import { createKeycloakAdmin } from "./keycloakAdmin.js";
import { createCloudRunIdentityTokenProvider } from "../utils/cloudRunIdentity.js";

const user = {
  id: "66a100000000000000000003",
  email: "customer1@shopsphere.test",
  firstName: "Rojina",
  lastName: "Maharjan",
  role: "user",
  isVerified: true,
};

test("Keycloak admin calls authenticate to private Cloud Run separately from Keycloak", async () => {
  const paths = [];
  const admin = createKeycloakAdmin({
    origin: "https://stage-auth.run.app",
    issuer: "https://stage-login.run.app/realms/shopsphere",
    clientId: "shopsphere-account-sync",
    clientSecret: "stage-secret",
    cloudRunIdToken: async () => "google-id-token",
    fetchImpl: async (url, init) => {
      paths.push(new URL(url).pathname);
      assert.equal(init.headers["x-serverless-authorization"], "Bearer google-id-token");
      if (paths.length === 1) return Response.json({ access_token: "keycloak-token", expires_in: 60 });
      assert.equal(init.headers.authorization, "Bearer keycloak-token");
      if (paths.length === 2) return Response.json([{ id: "user-uuid", username: user.id }]);
      if (paths.length === 3) return new Response(null, { status: 204 });
      if (paths.length === 4) return Response.json({ attributes: {
        shopsphere_user_id: [user.id],
        shopsphere_role: [user.role],
        shopsphere_verified: ["true"],
      } });
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(await admin.ensureUser(user, "synthetic-password"), "user-uuid");
  assert.equal(paths.length, 5);
});

test("account linking fails closed if Keycloak drops identity attributes", async () => {
  let calls = 0;
  const admin = createKeycloakAdmin({
    origin: "http://localhost:8080",
    issuer: "http://localhost:8080/realms/shopsphere",
    clientId: "shopsphere-account-sync",
    clientSecret: "local-secret",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return Response.json({ access_token: "keycloak-token", expires_in: 60 });
      if (calls === 2) return Response.json([{ id: "user-uuid", username: user.id }]);
      if (calls === 3) return new Response(null, { status: 204 });
      if (calls === 4) return Response.json({ attributes: {} });
      throw new Error("password must not be changed");
    },
  });
  await assert.rejects(admin.ensureUser(user, "synthetic-password"), /attributes were not stored/);
  assert.equal(calls, 4);
});

test("Cloud Run identity tokens require a fixed HTTPS Cloud Run audience", async () => {
  assert.throws(() => createCloudRunIdentityTokenProvider("https://example.com"));
  const provider = createCloudRunIdentityTokenProvider("https://stage-auth.run.app", {
    fetchImpl: async (url, init) => {
      assert.equal(url.searchParams.get("audience"), "https://stage-auth.run.app");
      assert.equal(init.headers["Metadata-Flavor"], "Google");
      return new Response("google-id-token", { status: 200 });
    },
  });
  assert.equal(await provider(), "google-id-token");
});
