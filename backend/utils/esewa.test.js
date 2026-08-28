import assert from "node:assert/strict";
import test from "node:test";

process.env.ESEWA_SECRET_KEY = "test-secret";
const { verifyCallbackSignature, signCheckoutFields } = await import("./esewa.js");

test("verifyCallbackSignature accepts a payload signed with the same secret", () => {
  const { signature, signedFieldNames } = signCheckoutFields({
    totalAmount: "100",
    transactionUuid: "txn-1",
  });
  const payload = {
    total_amount: "100",
    transaction_uuid: "txn-1",
    product_code: "EPAYTEST",
    signed_field_names: signedFieldNames,
    signature,
  };
  assert.equal(verifyCallbackSignature(payload), true);
});

test("verifyCallbackSignature rejects a tampered field", () => {
  const { signature, signedFieldNames } = signCheckoutFields({
    totalAmount: "100",
    transactionUuid: "txn-1",
  });
  const payload = {
    total_amount: "999", // attacker inflates/deflates the confirmed amount
    transaction_uuid: "txn-1",
    product_code: "EPAYTEST",
    signed_field_names: signedFieldNames,
    signature,
  };
  assert.equal(verifyCallbackSignature(payload), false);
});

test("verifyCallbackSignature rejects a missing signature or field list", () => {
  assert.equal(verifyCallbackSignature({ total_amount: "100" }), false);
  assert.equal(verifyCallbackSignature(null), false);
});
