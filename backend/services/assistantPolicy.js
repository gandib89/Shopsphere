import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ASSISTANT_POLICY_VERSION } from "./assistantPublicCatalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAQ_PATH = path.resolve(__dirname, "../chatbot/faqs.json");

export const POLICY_TOPICS = Object.freeze([
  "returns",
  "delivery",
  "payment",
  "warranty",
  "authenticity",
  "tracking",
  "cancellation",
  "seller-onboarding",
  "support-contact",
]);

const TOPIC_SOURCES = Object.freeze({
  returns: [0],
  delivery: [1],
  payment: [2, 3, 14],
  warranty: [5],
  authenticity: [4],
  tracking: [6],
  cancellation: [7],
  "seller-onboarding": [11],
  "support-contact": [13],
});

export const getApprovedPolicy = async (topic) => {
  const faqs = JSON.parse(await fs.readFile(FAQ_PATH, "utf8"));
  const indexes = TOPIC_SOURCES[topic];
  if (!indexes) {
    return { topic, answer: "Unknown policy topic.", sources: [] };
  }
  const approved = indexes.flatMap((index) => (faqs[index]?.a ? [{ index, answer: faqs[index].a }] : []));
  if (approved.length === 0) {
    return { topic, answer: "No approved ShopSphere policy is available for this topic.", sources: [] };
  }
  return {
    topic,
    answer: approved.map(({ answer }) => answer).join(" "),
    sources: approved.map(({ index }) => ({
      sourceId: `faqs.json#${index + 1}`,
      sourceVersion: ASSISTANT_POLICY_VERSION,
    })),
  };
};
