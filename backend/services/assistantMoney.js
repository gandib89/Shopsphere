// Exact-decimal money helpers for assistant reads (#12/#13/#14).
// Assistant totals must never use JavaScript floating point or model-supplied
// totals: every amount is parsed to integer minor units (paisa), computed with
// integer arithmetic, and formatted back to a decimal string for the MCP
// Money/SignedMoney contracts.
export const ASSISTANT_CURRENCY = "NPR";

const invalid = () => new Error("Invalid money value");

// Strings and Prisma Decimal-like objects only. Raw JS numbers are refused:
// String(0.1 + 0.2) already carries binary float drift, so accepting numbers
// would launder it into assistant totals instead of failing closed.
const decimalText = (value) => {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object" && typeof value.toString === "function") return String(value);
  return null;
};

export const toCents = (value) => {
  const text = decimalText(value);
  if (text === null) throw invalid();
  const trimmed = text.trim();
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) throw invalid();
  const whole = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = whole * 100 + Number(fraction);
  if (!Number.isSafeInteger(cents)) throw invalid();
  return cents;
};

export const toSignedCents = (value) => {
  const text = decimalText(value);
  if (text === null) throw invalid();
  const trimmed = text.trim();
  const match = /^(-?)(\d{1,10})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) throw invalid();
  const magnitude = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(magnitude)) throw invalid();
  return match[1] ? -magnitude : magnitude;
};

export const centsToAmount = (cents) => {
  if (!Number.isSafeInteger(cents) || cents < 0) throw invalid();
  const whole = Math.trunc(cents / 100);
  const remainder = cents % 100;
  if (remainder === 0) return String(whole);
  if (remainder % 10 === 0) return `${whole}.${remainder / 10}`;
  return `${whole}.${String(remainder).padStart(2, "0")}`;
};

const centsToSignedAmount = (cents) => {
  if (!Number.isSafeInteger(cents)) throw invalid();
  return cents < 0 ? `-${centsToAmount(-cents)}` : centsToAmount(cents);
};

export const money = (cents, currency = ASSISTANT_CURRENCY) => ({
  amount: centsToAmount(cents),
  currency,
});

export const signedMoney = (cents, currency = ASSISTANT_CURRENCY) => ({
  amount: centsToSignedAmount(cents),
  currency,
});

const clampedBasisPoints = (percentage) => Math.min(Math.max(0, toSignedCents(percentage)), 10_000);

// Applies an exact decimal percentage to integer cents with half-up rounding.
// BigInt is required for the intermediate product: a valid Decimal(12,2)
// amount multiplied by 10,000 is larger than Number.MAX_SAFE_INTEGER.
export const percentageOfCents = (cents, percentage) => {
  if (!Number.isSafeInteger(cents) || cents < 0) throw invalid();
  const basisPoints = clampedBasisPoints(percentage);
  const result = (BigInt(cents) * BigInt(basisPoints) + 5_000n) / 10_000n;
  const asNumber = Number(result);
  if (!Number.isSafeInteger(asNumber)) throw invalid();
  return asNumber;
};

// Discounted unit price in cents. Percentages must remain exact decimal text
// (or a Prisma Decimal-like object); raw JavaScript numbers are refused for the
// same reason they are refused by toCents.
export const percentOffCents = (listCents, discountPct) => {
  const discountCents = percentageOfCents(listCents, discountPct);
  return listCents - discountCents;
};
