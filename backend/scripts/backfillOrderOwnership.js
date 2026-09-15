// Backfill immutable seller-at-purchase attribution (#11 forward-repair).
// Updates ONLY trustworthy legacy rows: non-null buyer, product owner present,
// and no conflicting/ambiguous revenue sellers. Everything else keeps
// sellerIdAtPurchase NULL (quarantined from assistant reads) for human repair.
// Idempotent: rows already carrying an attribution are never touched.
// Usage: node scripts/backfillOrderOwnership.js [--apply] [--limit N]
import { prisma } from "../database/prismaClient.js";
import { classifyOwnership } from "../services/orderOwnership.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  }),
);
const APPLY = args.apply !== undefined && args.apply !== "false";
const LIMIT = Number(args.limit) || 1000;

const run = async (client = prisma) => {
  const candidates = await client.order.findMany({
    where: { sellerIdAtPurchase: null },
    select: {
      id: true,
      userId: true,
      sellerIdAtPurchase: true,
      product: { select: { sellerId: true } },
      revenues: { select: { sellerId: true } },
    },
    take: LIMIT,
  });

  let backfilled = 0;
  let quarantined = 0;
  const quarantineReasons = {};
  for (const row of candidates) {
    const verdict = classifyOwnership({
      userId: row.userId,
      sellerIdAtPurchase: row.sellerIdAtPurchase,
      productSellerId: row.product?.sellerId || null,
      revenueSellerIds: (row.revenues || []).map((r) => r.sellerId),
    });
    if (verdict.quarantined || !verdict.backfillSellerId) {
      quarantined += 1;
      const reason = verdict.reason || "null_seller";
      quarantineReasons[reason] = (quarantineReasons[reason] || 0) + 1;
      continue;
    }
    if (APPLY) {
      const claimed = await client.order.updateMany({
        where: { id: row.id, sellerIdAtPurchase: null },
        data: { sellerIdAtPurchase: verdict.backfillSellerId },
      });
      if (claimed.count === 1) backfilled += 1;
    } else {
      backfilled += 1;
    }
  }
  return { scanned: candidates.length, backfilled, quarantined, quarantineReasons, applied: APPLY };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  run()
    .then((summary) => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(summary));
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => client_disconnect());

  async function client_disconnect() {
    try {
      await prisma.$disconnect();
    } catch {
      // ponytail: disconnect is best-effort in CLI use
    }
  }
}

export default run;
