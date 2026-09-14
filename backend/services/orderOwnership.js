// Ownership attribution helpers for issue #11.
// Single place deciding which order rows assistant reads may touch.
// Storefront controllers keep working on legacy rows; assistant scopes must use these.
export const QUARANTINE_REASONS = Object.freeze({
  NULL_BUYER: "null_buyer",
  NULL_SELLER: "null_seller",
  CONFLICTING_SELLER: "conflicting_seller",
  AMBIGUOUS_SELLER: "ambiguous_seller",
});

// Pure classifier over PG16-shape rows. Inputs are plain values so tests and the
// backfill script share one rule without a database.
export const classifyOwnership = ({ userId, sellerIdAtPurchase, productSellerId, revenueSellerIds = [] } = {}) => {
  if (!userId) return { quarantined: true, reason: QUARANTINE_REASONS.NULL_BUYER };
  const distinctRevenueSellers = [...new Set((revenueSellerIds || []).filter(Boolean))];
  if (distinctRevenueSellers.length > 1) return { quarantined: true, reason: QUARANTINE_REASONS.AMBIGUOUS_SELLER };
  const revenueSeller = distinctRevenueSellers[0] || null;
  // A repaired row whose attribution disagrees with every trustworthy source is
  // conflicting (e.g. manual edit or cross-seller merge) — quarantine for humans.
  if (sellerIdAtPurchase) {
    if (productSellerId && sellerIdAtPurchase !== productSellerId && revenueSeller && sellerIdAtPurchase !== revenueSeller) {
      return { quarantined: true, reason: QUARANTINE_REASONS.CONFLICTING_SELLER };
    }
    if (revenueSeller && sellerIdAtPurchase !== revenueSeller) {
      return { quarantined: true, reason: QUARANTINE_REASONS.CONFLICTING_SELLER };
    }
    return { quarantined: false, reason: null };
  }
  // Unrepaired legacy row: trustworthy only when product and revenue agree (or no
  // revenue row exists yet to contradict the product owner).
  if (!productSellerId) return { quarantined: true, reason: QUARANTINE_REASONS.NULL_SELLER };
  if (revenueSeller && revenueSeller !== productSellerId) {
    return { quarantined: true, reason: QUARANTINE_REASONS.CONFLICTING_SELLER };
  }
  return { quarantined: false, reason: null, backfillSellerId: productSellerId };
};

export const isQuarantined = (row) => classifyOwnership(row).quarantined;

// Buyer assistant reads: verified immutable userId only. Never email.
export const buildBuyerOrderWhere = (userId, extra = {}) => ({ ...extra, userId });

// Seller assistant reads: immutable attribution only. Legacy rows whose
// sellerIdAtPurchase is still NULL are quarantined (excluded), never claimed via
// present-day Product.sellerId.
export const buildSellerOrderWhere = (sellerId, extra = {}) => ({ ...extra, sellerIdAtPurchase: sellerId });

// Storefront fallback for pre-backfill rows: immutable attribution when present,
// otherwise the legacy present-day product-owner join. Assistant code must NOT use this.
export const buildSellerStorefrontWhere = (sellerId) => ({
  OR: [
    { sellerIdAtPurchase: sellerId },
    { sellerIdAtPurchase: null, product: { sellerId } },
  ],
});

// An existing repaired attribution is immutable — never overwrite it.
export const resolveSellerIdAtPurchase = (order, productSellerId) =>
  order?.sellerIdAtPurchase || productSellerId || null;
