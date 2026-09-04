import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(
  readFileSync(path.join(__dirname, "output/recommendations_map.json"), "utf-8")
);

const itemsFor = (key) => (map[key] || []).map((entry) => entry.item);

// train_apriori.py title-cases every item, so the keys are "Mac Mini", not "Mac mini".
test("the shipped model reproduces the store's real attach behaviour", () => {
  // A Mac mini ships without a keyboard, mouse or display.
  const macMini = itemsFor("Mac Mini");
  assert.ok(macMini.includes("Apple Magic Keyboard"), macMini.join(", "));
  assert.ok(macMini.includes("Apple Magic Mouse"), macMini.join(", "));

  // An iPhone ships without a charger, and almost nobody leaves without a case.
  const iphone = itemsFor("Iphone 17 Pro Max");
  assert.ok(iphone.includes("Apple 20W Usb C Power Adapter"), iphone.join(", "));
  assert.ok(
    iphone.some((item) => item.includes("Case") || item.includes("Screen Protector")),
    iphone.join(", ")
  );

  // A watch buyer adds a band.
  assert.ok(itemsFor("Apple Watch").some((item) => item.includes("Band") || item.includes("Loop")));
});

test("every store category is a key, so unseen seller products still get rules", () => {
  // Mirrors the category <select> in frontend/src/pages/AddProduct.tsx. The
  // controller falls back to these keys for any product name the model has
  // never seen — without them a seller's own upload gets nothing from Apriori.
  for (const category of [
    "Iphone",
    "Macbook",
    "Mac Mini",
    "Ipad",
    "Apple Watch",
    "Speakers",
    "Accessories",
  ]) {
    assert.ok(map[category]?.length > 0, `no rules for category ${category}`);
  }
});

test("metrics are ordered strongest-first", () => {
  for (const [key, entries] of Object.entries(map)) {
    for (let i = 1; i < entries.length; i += 1) {
      assert.ok(entries[i - 1].lift >= entries[i].lift, `${key} is not sorted by lift`);
    }
  }
});
