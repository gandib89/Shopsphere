# ShopSphere industry comparison

Assessment date: 6 September 2026. Based on repository inspection and local checks, not a live production or visual usability audit.

## Remediation update

The two critical findings below were fixed later on 6 September 2026. Cancellation now atomically claims the order, leaves unpaid inventory unchanged, and restores confirmed inventory once. Refunds now have a persisted, idempotent lifecycle with a clearly labelled sandbox provider; successful settlement updates the order, audit event and revenue atomically. A live eSewa refund adapter is still intentionally unavailable because the public ePay documentation does not expose a merchant refund-initiation endpoint.

## Verdict

**8/10 as a portfolio project; 5.5/10 against mature commerce production expectations.** These are reviewer judgments, not certified scores or percentile rankings. The production comparison is the equal-weight average of the six dimensions below. The portfolio rating separately credits implementation breadth and engineering depth.

| Dimension | Score / 10 | Evidence and limits |
| --- | ---: | --- |
| Commerce and marketplace features | 7 | Customer, seller and admin flows; seller approval, cart, promotions, reviews, orders, returns, revenue views and eSewa integration. No implementation located for seller payouts, multi-location inventory, tax engines or carrier integrations. |
| Transaction correctness | 5 | Server-derived pricing, conditional product-stock decrement, checkout idempotency, payment verification and append-only payment events are valuable. Cancellation, inventory variants and actual refund execution need work. |
| Security foundations | 6 | Argon2 password hashing, short-lived access tokens, rotating hashed refresh tokens, role/ownership checks and rate limits. Production CORS still permits broad local/network origins. No ASVS assessment performed. |
| Maintainability and automated verification | 6 | Substantial passing tests, Prisma migrations, reusable UI components and CI. Type checking fails; lint has 59 warnings; order controller exceeds 1,900 lines; CI omits lint and type checking. |
| Operations and scale evidence | 4 | Docker, PostgreSQL, health/readiness endpoints and structured request logging. No evidence established for tested restores, alerting, durable job retries, payment reconciliation or load capacity. These are evidence gaps, not proof the deployment lacks them. |
| Accessibility and web discoverability | 5 | Shared form/UI components and route lazy loading. Viewport disables zoom, public storefront uses hash routing, and static HTML has minimal metadata. No browser accessibility, visual, SEO crawl or Core Web Vitals audit performed. |

## Comparison with established platforms

- **Shopify:** ShopSphere implements much of the basic shopping journey and adds its own seller/admin experience. Shopify is the stronger benchmark for mature merchant operations, including abandoned checkout recovery, reports and connected sales channels. Matching a dashboard does not establish equivalent operations. [Official Shopify features](https://help.shopify.com/en/manual/intro-to-shopify/pricing-plans/plans-features/features-on-all-plans)
- **Medusa:** A closer architectural comparator for custom commerce. Its documented modules cover inventory, stock locations, fulfillment, tax, regions, pricing and other commerce domains. ShopSphere has a narrower implementation and more logic concentrated in controllers. Medusa also requires marketplace customization; its vendor support should not be represented as automatically turnkey. [Commerce modules](https://docs.medusajs.com/resources/commerce-modules), [marketplace example](https://docs.medusajs.com/resources/recipes/marketplace/examples/vendors)
- **Security and accessibility:** OWASP ASVS and WCAG 2.2 AA provide verification targets. ShopSphere has useful security controls, but this review cannot establish conformance to either standard. [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/), [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## Most important gaps

1. **Cancellation inventory correctness.** `backend/controller/order.js:1607` permits cancelling Pending or Confirmed orders, always restores stock, then updates status by ID. Pending order creation explicitly defers stock deduction until confirmation (`order.js:485`), so cancelling an unpaid Pending order can increase stock that was never deducted. The pre-transaction status check and unconditional update also permit concurrent cancellations to restore stock repeatedly. Findings from code inspection; not reproduced against a database.
2. **Refund execution.** `backend/controller/order.js:1862` marks a refund released, modifies revenue and emails the customer; it does not call a gateway refund API. Revenue updates occur separately and failure is treated as non-fatal. This supports a simulated/manual bookkeeping flow, not evidence that money was refunded. The app explicitly defaults to sandbox demo mode (`frontend/src/App.tsx:53`).
3. **Inventory model and lifecycle.** Product quantity has a conditional decrement, but color/storage decrements in `backend/controller/order.js:141` lack an equivalent stock predicate. Product options in `backend/prisma/schema.prisma:128` model individual selections rather than unique SKUs for combinations. Verify inventory across every selection, cancellation, payment retry and return, with real database concurrency tests. Returns currently restore stock on approval before the email asks the customer to ship it back.
4. **Quality gates.** Fix the type error in `frontend/src/pages/ProductDetailsPage.tsx:226`; run explicit type checking and lint in CI. Add full checkout-to-refund browser/database tests and failure recovery checks. Current passing component and controller tests do not prove live gateway operation or concurrency safety.
5. **Launch readiness.** Restrict production origins, permit zoom (`frontend/index.html:6`), establish crawlable public product URLs/metadata, and verify keyboard/mobile shopping flows. Establish backup restores, alerting and payment reconciliation before accepting real orders. A single modular application can meet these needs; microservices are not a prerequisite.

## Checks run

| Check | Result |
| --- | --- |
| Backend `npm test` | 100 passed, 1 skipped; skipped test requires opt-in database integration execution |
| Frontend `npm test` | 149 passed across 18 files |
| Frontend `npm run build` | Passed, with a chunk-size warning over 500 kB |
| Frontend `npm run lint` | 0 errors, 59 warnings |
| Frontend `npx tsc -b` | Failed: TS2322 at ProductDetailsPage.tsx:226, literal `placeholder` type mismatch |

No payment was initiated, no production deployment was evaluated, and no application source was changed. Local check logs are in `tmp/industry-*.log`. Source research is in [industry-benchmarks.md](industry-benchmarks.md).
