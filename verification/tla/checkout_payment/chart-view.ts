// View for /statechart: the checkout flow in the shopper's words. Use with flow.cfg.
type V = { [k: string]: any };

const payment = (v: V) => {
  const p = v.pay[1], g = v.gw[1];
  if (p === "none") return "No payment yet";
  if (p === "Initiated") {
    if (g === "none") return "eSewa form open";
    if (g === "PENDING") return "Paying at eSewa";
    if (g === "COMPLETE") return "Charged, not yet recorded";
    return "Abandoned at eSewa";
  }
  if (p === "Succeeded") return "Paid";
  return g === "COMPLETE" ? "Charged but recorded as failed" : "Payment failed";
};

const orders = (v: V) => {
  const s = Object.values(v.status) as string[];
  if (s.includes("Confirming")) return "Item stuck confirming";
  if (s.every((x) => x === "Pending")) return "Order placed";
  if (s.every((x) => x === "Confirmed")) return "Order confirmed";
  if (s.every((x) => x === "Cancelled")) return "Order cancelled";
  if (s.includes("Confirmed")) return "Partly confirmed";
  return "Partly cancelled";
};

export const title = "Checkout with eSewa (one cart, two items)";
export const state = (v: V) => ({ Payment: payment(v), Order: orders(v) });

export const step = (action: string, _from: V, to: V) => {
  switch (action) {
    case "Checkout": return "you press Pay with eSewa";
    case "CustomerPays": return "you submit payment at eSewa";
    case "GatewaySettles": return to.gw[1] === "COMPLETE" ? "eSewa completes the charge" : "eSewa cancels the payment";
    case "OtherBuyerTakesStock": return "another buyer takes the last unit";
    case "Cancel": return "you cancel an item";
    case "CbRead": return "eSewa redirects you back";
    case "CbCheck": return "ShopSphere asks eSewa for the status";
    case "CbConfirmStart": return "ShopSphere starts confirming";
    case "CbConfirmOne": return "ShopSphere confirms an item";
    case "CbMark": return "ShopSphere records the eSewa result";
    default: return null;
  }
};
