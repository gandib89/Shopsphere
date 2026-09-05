// The one place a price is derived from a product plus the options a buyer picked. Every server
// path (cart, order, revenue) goes through it, so a client can never pay the base price for an
// upgraded configuration by posting its own numbers.
export const optionPriceDelta = (product, variants) => {
  const options = product?.options || [];
  if (!options.length || !variants) return 0;
  return Object.entries(variants).reduce((total, [kind, value]) => {
    const option = options.find(candidate => candidate.kind === kind && candidate.value === value);
    return total + (option ? Number(option.priceDelta) || 0 : 0);
  }, 0);
};

export const listPriceWithOptions = (product, variants) =>
  Number(product.price) + optionPriceDelta(product, variants);

export const effectiveProductPrice = (product, variants) => {
  const price = listPriceWithOptions(product, variants);
  const discount = Math.min(100, Math.max(0, Number(product.discount) || 0));
  return Math.round(price * (1 - discount / 100) * 100) / 100;
};
