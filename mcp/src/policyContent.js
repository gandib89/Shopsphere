export const POLICY_VERSION = "1.0.0";

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

const UNKNOWN_ANSWER =
  "Unknown policy topic. No approved ShopSphere policy covers this topic.";

const entries = Object.freeze({
  returns: Object.freeze({
    answer:
      "You can return any product within 7 days of delivery as long as it is unused and in its original packaging. Contact us at support@shopsphere.com to initiate a return.",
    sourceId: "faqs.json#return-policy",
  }),
  delivery: Object.freeze({
    answer:
      "Delivery within Pokhara Valley takes 1–2 business days. For other areas of Nepal, it typically takes 3–5 business days.",
    sourceId: "faqs.json#delivery-time",
  }),
  payment: Object.freeze({
    answer:
      "We accept eSewa and cash on delivery (COD) for orders within Pokhara Valley. For orders outside the valley, online payment is required. All online payments go through eSewa.",
    sourceId: "faqs.json#payment-methods",
  }),
  warranty: Object.freeze({
    answer:
      "All Apple products come with Apple's official 1-year limited warranty. Accessories come with a 6-month warranty.",
    sourceId: "faqs.json#warranty",
  }),
  authenticity: Object.freeze({
    answer:
      "All products on ShopSphere are 100% genuine Apple products and certified accessories. We source directly from authorized distributors.",
    sourceId: "faqs.json#genuine-products",
  }),
  tracking: Object.freeze({
    answer:
      "After placing your order, you can track its status in the 'My Orders' section of your account. You will also receive a confirmation email.",
    sourceId: "faqs.json#order-tracking",
  }),
  cancellation: Object.freeze({
    answer:
      "You can cancel an order while it is in 'Pending' status from the My Orders page. Once the order is processed or shipped, it cannot be cancelled.",
    sourceId: "faqs.json#cancellation",
  }),
  "seller-onboarding": Object.freeze({
    answer:
      "Click 'Sign In', choose 'Sign Up as Seller', fill in your shop details, and submit for admin verification. Approved sellers can start listing within 24–48 hours.",
    sourceId: "faqs.json#seller-onboarding",
  }),
  "support-contact": Object.freeze({
    answer:
      "You can reach us at support@shopsphere.com or call us during business hours (Sunday–Friday, 10am–6pm).",
    sourceId: "faqs.json#support-contact",
  }),
});

export const getStorePolicy = (topic) => {
  const entry = entries[topic];
  if (!entry) {
    return {
      topic: String(topic ?? "unknown"),
      answer: UNKNOWN_ANSWER,
      sourceId: "unknown",
      sourceVersion: POLICY_VERSION,
    };
  }
  return {
    topic,
    answer: entry.answer,
    sourceId: entry.sourceId,
    sourceVersion: POLICY_VERSION,
  };
};
