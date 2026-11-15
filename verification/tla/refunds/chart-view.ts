// View for /statechart: an order after payment, through delivery, return and
// refund, in the shopper's and admin's words. Use with flow.cfg.
type V = { [k: string]: any };

const o1 = (v: V) => {
  const s = v.status.o1 as string;
  return s === "Cancelled" ? "Item 1 cancelled" : s === "Refund Released" ? "Item 1 refunded" : `Item 1 ${s.toLowerCase()}`;
};

const refund = (v: V) => {
  const r = v.refund as string;
  const busy = Object.values(v.pc).some((p) => p === "claimed" || p === "called");
  if (r === "none") return "No refund";
  if (r === "Processing") return busy ? "Refund in progress" : "Refund stuck processing";
  return r === "Succeeded" ? `Refunded Rs ${v.moneyOut} of 2` : "Refund failed";
};

export const title = "After payment: delivery, return and refund (item 2 only kept or cancelled)";
export const state = (v: V) => ({
  "Item 1": o1(v),
  "Item 2": v.status.o2 === "Cancelled" ? "Item 2 cancelled" : "Item 2 kept",
  Refund: refund(v),
});

export const step = (action: string, from: V, to: V) => {
  switch (action) {
    case "Advance": return "the seller moves it along";
    case "Cancel": return "you cancel the item";
    case "RequestReturn": return "you request a return";
    case "ApproveReturn": return "the seller approves the return";
    case "RejectReturn": return "the seller rejects the return";
    case "Claim": return "an admin presses Release refund";
    case "ProviderCall": return "ShopSphere asks the provider to refund";
    case "Settle": return to.refund === "Succeeded" ? "the refund goes through" : "the refund fails";
    case "Retry": return "the admin tries again";
    case "Crash": return "the server dies mid-refund";
    default: return null;
  }
};
