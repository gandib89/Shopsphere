export const sandboxRefundProvider = {
  async refund({ payment, amount }) {
    if (process.env.SANDBOX_REFUND_OUTCOME === "failure") {
      return { status: "Failed", failureReason: "Simulated sandbox provider rejection" };
    }

    return {
      status: "Succeeded",
      providerRefundId: `sandbox-refund-${payment.transactionUuid}`,
      amount,
    };
  },
};

export const getRefundProvider = (mode = process.env.PAYMENT_MODE || (process.env.NODE_ENV === "production" ? "unconfigured" : "sandbox")) => {
  if (mode === "sandbox") return sandboxRefundProvider;
  const error = new Error("Live eSewa refunds are not configured. Use the sandbox refund workflow.");
  error.statusCode = 503;
  throw error;
};
