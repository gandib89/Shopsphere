import crypto from "crypto";

const SECRET_KEY = process.env.ESEWA_SECRET_KEY;
const PRODUCT_CODE = process.env.ESEWA_PRODUCT_CODE || "EPAYTEST";
const FORM_ACTION_URL = process.env.ESEWA_FORM_URL || "https://rc-epay.esewa.com.np/api/epay/main/v2/form";
const STATUS_CHECK_URL = process.env.ESEWA_STATUS_URL || "https://rc.esewa.com.np/api/epay/transaction/status/";

const hmacBase64 = (message) => crypto.createHmac("sha256", SECRET_KEY).update(message).digest("base64");

// Signs the fields eSewa requires on the outbound checkout form. Secret never leaves the server.
export const signCheckoutFields = ({ totalAmount, transactionUuid, productCode = PRODUCT_CODE }) => {
  const signedFieldNames = "total_amount,transaction_uuid,product_code";
  const message = `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${productCode}`;
  return { signature: hmacBase64(message), signedFieldNames, productCode };
};

export const decodeCallbackPayload = (base64Data) =>
  JSON.parse(Buffer.from(base64Data, "base64").toString("utf-8"));

// Verifies the signature eSewa attaches to its success_url `data` payload.
export const verifyCallbackSignature = (payload) => {
  if (!payload?.signed_field_names || !payload?.signature) return false;
  const message = payload.signed_field_names
    .split(",")
    .map((field) => `${field}=${payload[field]}`)
    .join(",");
  return hmacBase64(message) === payload.signature;
};

// Server-to-server confirmation call — eSewa has no push webhook, so this status check is what
// authoritatively confirms a transaction rather than trusting the browser redirect alone.
export const checkTransactionStatus = async ({ productCode = PRODUCT_CODE, totalAmount, transactionUuid }) => {
  const url = `${STATUS_CHECK_URL}?product_code=${encodeURIComponent(productCode)}&total_amount=${encodeURIComponent(totalAmount)}&transaction_uuid=${encodeURIComponent(transactionUuid)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`eSewa status check failed with HTTP ${response.status}`);
  }
  return response.json(); // { product_code, transaction_uuid, total_amount, status, ref_id }
};

export { FORM_ACTION_URL, PRODUCT_CODE as DEFAULT_PRODUCT_CODE };
