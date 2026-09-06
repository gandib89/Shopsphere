# ShopSphere catalogue lower-space patterns

Research date: **2026-09-06**  
Scope: desktop product-list layouts where a tall filter rail sits beside a short product row. Sources are current first-party retailer pages, Shopify's official reference theme and directly applicable Baymard product-list research.

## Executive recommendation

The empty lower-right area is primarily a structural mismatch: ShopSphere presents **38 filterable products** as a one-row horizontal shelf while the filter column establishes a much taller section. Do not fill that hole with unrelated promotion. Make the results area a responsive, multi-row catalogue grid; keep the horizontal carousel only as a separate curated “Popular right now” shelf.

This is the clearest industry pattern. Best Buy pairs its filter column with a paginated product list (for example, 1–18 of the result set), while IKEA pairs “Sort and Filter” with a continuous product listing, shows 24 of 244 results, and then offers “Show more.” Walmart likewise follows its filters and sort controls with a large vertical result set. See [Best Buy laptops](https://www.bestbuy.com/site/searchpage.jsp?browsedCategory=pcmcat138500050001), [IKEA desks](https://www.ikea.com/us/en/cat/desks-computer-desks-20649/), and [Walmart laptop search](https://www.walmart.com/search?q=laptop).

Shopify's own Dawn reference theme encodes the same structure: selectable vertical or horizontal facets, a responsive product grid, product counts, pagination, and an explicit no-results state. See Shopify's [collection product-grid implementation](https://github.com/Shopify/dawn/blob/main/sections/main-collection-product-grid.liquid) and [facets implementation](https://github.com/Shopify/dawn/blob/main/snippets/facets.liquid).

## Options ranked for ShopSphere

### 1. Responsive multi-row product grid — recommended

Replace the filter-adjacent horizontal carousel with a 2–3-column grid that renders a useful first batch, then pagination or “Show more.” At the current desktop width, three compact cards per row would use the space efficiently; two columns can remain the intermediate breakpoint. Keep the result count and add a clear `Showing 1–12 of 38` status.

Why it fits ShopSphere:

- It resolves the whitespace using products users came to browse.
- It makes filtering, sorting and comparison behave like one coherent catalogue.
- It removes reliance on precise horizontal controls for reaching most of the 38 products.
- It matches Best Buy, IKEA, Walmart and Shopify Dawn's catalogue structure cited above.

Implementation direction: let the results determine the section height; do not give the shared catalogue row a filter-derived `min-height`. The filter rail can be `position: sticky` within the two-column layout without stretching the results surface.

Baymard's product-list research says the list, filters and sorting need to work as a unified system, and identifies balanced grid/list layouts as essential to product overview. Its loading research also warns that too few initially visible products can lead users to underestimate the assortment. See [Product Lists & Filtering UX](https://baymard.com/research/ecommerce-product-lists) and [Number of Products to Load](https://baymard.com/blog/number-of-items-loaded-by-default).

### 2. Split “Popular right now” from “All products”

Keep the existing horizontal shelf, but make it a short, full-width editorial module with perhaps 4–8 genuinely popular products and **no filters**. Follow it with an “All products” section that contains the filters and the multi-row grid from option 1.

Why it fits ShopSphere: the current heading promises a curated popularity shelf, while the count and facets promise a complete catalogue. Separating those two jobs makes both interactions easier to understand and retains the carousel work already present.

Apple uses this separation of concerns on [Shop Mac](https://www.apple.com/shop/buy-mac): its finite model shelf is followed by distinct shopping-guide, comparison, specialist-help and savings sections rather than being presented as a large faceted result set.

### 3. Compact the filters into a top toolbar

If ShopSphere intends to retain a one-row product shelf, move Price, Status, Brand and Type into a horizontal filter/sort toolbar or a filter drawer. This removes the tall left rail that creates the visual imbalance.

Shopify's official storefront guidance says a horizontal toolbar works best for smaller stores needing fewer than five filters at a time, while a vertical sidebar is better for more than five. ShopSphere currently exposes four groups, so this is a credible alternative, though it will scale less well as category-specific facets are added. See [Shopify storefront filtering UX guidelines](https://shopify.dev/docs/storefronts/themes/navigation-search/filtering/storefront-filtering/storefront-filtering-ux).

### 4. Curated small-assortment layout for categories with very few results

When a category truly has only two or three model families, remove the faceted sidebar and present richer comparison cards, followed by a “Which one is right for you?” guide, category links, or shopping help. Apple demonstrates this on [Shop Mac](https://www.apple.com/shop/buy-mac), where a finite “All models” presentation leads into comparison and specialist-help modules.

Use this as a conditional template, not the default 38-product catalogue. It is especially suitable after filters narrow the assortment to a handful of structurally different products.

### 5. Explicit result-end state and full-width guidance — supplemental only

For a legitimately short filtered result set, end the results column with a compact message such as `That's all 2 matching products`, plus `Clear filters` and `View all products`. Any comparison guide, category shortcuts, delivery/returns information or specialist-help content should start **below the entire two-column catalogue**, full width; it should not be inserted only into the lower-right hole.

This follows the spirit of Shopify Dawn's explicit empty/no-results handling and IKEA's sequencing: product results end clearly, then editorial and recommendation content begins as a separate section ([Dawn collection grid](https://github.com/Shopify/dawn/blob/main/sections/main-collection-product-grid.liquid), [IKEA desks](https://www.ikea.com/us/en/cat/desks-computer-desks-20649/)).

## Suggested ShopSphere composition

1. Keep `Popular right now` as a full-width carousel above the catalogue, without facets.
2. Add `Shop all products` below it with result count, sort, applied-filter chips, a sticky filter rail and a 3-column desktop grid.
3. Render 12 products initially, then use pagination or `Show more`; preserve the user's scroll position and filters when returning from product details.
4. After the catalogue, add a full-width comparison/help module only if useful content exists.

## Avoid

- Decorative banners or unrelated recommendations placed solely in the lower-right blank region.
- A fixed/minimum catalogue height inherited from the filter rail.
- Calling a 38-product browse surface “Popular right now” while also attaching full-catalogue filters to it.
- More product-card metadata merely to make each card taller; Baymard recommends selecting information that helps users evaluate products, not adding content for visual bulk ([Product-list item information](https://baymard.com/blog/product-listing-information)).

