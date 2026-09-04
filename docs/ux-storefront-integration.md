# UX demo promoted to the main storefront

The main `#/` route now renders the approved UX layout through `StorefrontView`.
`#/ux-demo` retains its separate fixture products and temporary demo bag;
`#/ui-redesign-demo` remains the palette experiment.

## Preserved design and behavior

- Light theme, textured content background, dark full-screen hero, and existing container widths.
- Header search with category choices, image-led bordered cards, and hover/focus purchase actions.
- The existing section-scroll controller is reused unchanged, including tall-section stops and reduced-motion support.
- Header height is included in hero sizing, with or without the configured sandbox banner.

## Real shopping integration

- `Home` loads the public product endpoint and maps server IDs, images, prices, discounts, reviews, and stock into the shared view. No demo inventory is used as a fallback.
- Search and category filtering operate on the loaded catalogue; sorting uses discounted prices.
- Quick view links to the existing detail page. Configurable products use that page for option selection; unavailable products cannot be quick-added.
- Signed-in buyers add through the existing cart API. Only the product ID and quantity are submitted; pricing is resolved by the backend. The bag count comes from the server response, and the bag button opens the existing cart/checkout flow.
- Guests sign in before adding; seller/admin purchase controls remain restricted. Account buttons route to the appropriate profile/dashboard, and notifications remain available.
- Checkout, authentication, order processing, payment configuration, and backend/database code are unchanged.

## Verification

Frontend tests cover demo regression, real catalogue mapping, search/category/sort,
guest and role routing, server cart counts, repeated clicks, request failures,
expired sessions, option selection, sold-out stock, broken images, and retry/empty states.
Browser checks cover desktop/mobile hero sizing, section navigation, real product
loading, mobile search, and quick view. Cart mutations are tested with mocked
responses; no real orders or payments are used for verification.

Run from `frontend`:

```text
npm test
npx --no-install tsc -p tsconfig.app.json --noEmit
npm run build
```

This is a source-code integration and local preview, not a deployment to a hosted site.
