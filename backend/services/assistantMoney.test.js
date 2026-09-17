import assert from "node:assert/strict";
import test from "node:test";

import {
  centsToAmount,
  money,
  percentageOfCents,
  percentOffCents,
  signedMoney,
  toCents,
  toSignedCents,
} from "./assistantMoney.js";

test("decimal strings convert to exact integer cents without float drift", () => {
  assert.equal(toCents("10.00"), 1000);
  assert.equal(toCents("0.1"), 10);
  assert.equal(toCents("0.07"), 7);
  assert.equal(toCents({ toString: () => "4.55" }), 455);
  // 0.1 + 0.2 float drift must not leak into assistant totals.
  assert.equal(toCents("0.1") + toCents("0.2"), 30);
  // Raw JS numbers are refused: String(0.1 + 0.2) already drifted before we
  // see it, so numbers fail closed instead of laundering float error.
  assert.throws(() => toCents(19.99), /invalid money/i);
});

test("invalid money values are rejected instead of coerced", () => {
  for (const bad of ["", "abc", "10.999", "-5", "1,000", null, undefined, NaN, {}]) {
    assert.throws(() => toCents(bad), /invalid money/i);
  }
});

test("signed deltas parse for option price adjustments", () => {
  assert.equal(toSignedCents("-2.50"), -250);
  assert.equal(toSignedCents("5"), 500);
  assert.equal(toSignedCents({ toString: () => "-0.99" }), -99);
  assert.throws(() => toSignedCents("10.999"), /invalid money/i);
});

test("cents format back to minimal decimal strings", () => {
  assert.equal(centsToAmount(1000), "10");
  assert.equal(centsToAmount(1050), "10.5");
  assert.equal(centsToAmount(1055), "10.55");
  assert.equal(centsToAmount(0), "0");
});

test("money wraps cents with the NPR currency", () => {
  assert.deepEqual(money(1999), { amount: "19.99", currency: "NPR" });
  assert.deepEqual(signedMoney(-250), { amount: "-2.5", currency: "NPR" });
  assert.deepEqual(signedMoney(0), { amount: "0", currency: "NPR" });
});

test("percentage discounts round half-up on exact cents", () => {
  assert.equal(percentOffCents(1000, "0"), 1000);
  assert.equal(percentOffCents(1000, "100"), 0);
  assert.equal(percentOffCents(199, "10"), 179);
  assert.equal(percentOffCents(1000, "150"), 0);
  assert.equal(percentOffCents(1000, "-5"), 1000);
});

test("fractional percentages use integer basis points, never float", () => {
  assert.equal(percentOffCents(10000, "12.5"), 8750);
  assert.equal(percentOffCents(10000, { toString: () => "12.5" }), 8750);
  assert.throws(() => percentOffCents(10000, 12.5), /invalid money/i);
  assert.throws(() => percentOffCents(10000, "12.555"), /invalid money/i);
});

test("percentage arithmetic stays exact at the largest accepted money value", () => {
  assert.equal(percentOffCents(999_999_996_949, "5.49"), 945_099_997_116);
  assert.equal(percentageOfCents(999_999_996_949, "5.49"), 54_899_999_833);
});
