import assert from "node:assert/strict";
import test from "node:test";

import { createCloudRunIdentityTokenProvider } from "../src/cloudRunIdentity.js";

test("fetches a backend-audience ID token from the Cloud Run metadata server", async () => {
  const audience = "https://shopsphere-stage-backend-123.asia-south1.run.app";
  const provider = createCloudRunIdentityTokenProvider(audience, {
    fetchImpl: async (url, init) => {
      assert.equal(url.hostname, "metadata.google.internal");
      assert.equal(url.pathname, "/computeMetadata/v1/instance/service-accounts/default/identity");
      assert.equal(url.searchParams.get("audience"), audience);
      assert.equal(init.headers["Metadata-Flavor"], "Google");
      return new Response("google-id-token", { status: 200 });
    },
  });
  assert.equal(await provider(), "google-id-token");
});

test("rejects a non-Cloud-Run token destination", () => {
  assert.throws(() => createCloudRunIdentityTokenProvider("https://example.com"));
  assert.throws(() => createCloudRunIdentityTokenProvider("http://backend:4000"));
  assert.throws(() => createCloudRunIdentityTokenProvider("https://user:pass@backend.run.app"));
  assert.throws(() => createCloudRunIdentityTokenProvider("https://backend.run.app:8443"));
});

test("fails closed when metadata returns an empty token", async () => {
  const provider = createCloudRunIdentityTokenProvider("https://backend.run.app", {
    fetchImpl: async () => new Response("  ", { status: 200 }),
  });
  await assert.rejects(provider(), /Cloud Run identity token unavailable/);
});

test("fails closed when metadata cannot provide a token", async () => {
  const provider = createCloudRunIdentityTokenProvider("https://backend.run.app", {
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
  });
  await assert.rejects(provider(), /Cloud Run identity token unavailable/);
});
