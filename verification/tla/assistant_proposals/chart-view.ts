// View for /statechart: an assistant cart proposal from preview to outcome. Use with flow.cfg.
type V = { [k: string]: any };

const outcome: { [s: string]: string } = {
  pending: "Waiting for you to confirm",
  executed: "Change applied",
  expired: "Expired",
  stale: "Stale: cart changed",
  rejected: "Rejected: product unavailable",
};

export const title = "Assistant cart proposal";
export const state = (v: V) => ({
  Proposal: outcome[v.status],
  Cart: v.cartVersion === 0 ? "Cart as previewed" : "Cart changed since preview",
});

export const step = (action: string) => {
  switch (action) {
    case "TimePasses": return "ten minutes pass";
    case "StorefrontCartWrite": return "you edit the cart in the store";
    case "ProductSellsOut": return "the product sells out";
    case "Expire": return "you confirm too late";
    case "Stale": return "you confirm, cart had changed";
    case "Reject": return "you confirm, product unavailable";
    case "Claim": return "ShopSphere claims the proposal";
    case "Load": return "you press Confirm";
    case "CheckCart": return "ShopSphere checks your cart";
    case "Apply": return "the change is written to the cart";
    default: return null;
  }
};
