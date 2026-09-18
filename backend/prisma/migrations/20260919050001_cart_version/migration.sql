-- Cart optimistic-concurrency version for #22. Bumped atomically (+1) by every
-- storefront cart mutation and by proposal execution, so a proposal can pin the
-- exact cart state it previewed and detect concurrent changes.
ALTER TABLE carts ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- Proposal previews read the cart version through the restricted assistant
-- runtime role (this migration ships after 20260919050000, which rewrites the
-- cart policies to admit the proposals.proposeCartChange operation).
GRANT SELECT ("version") ON TABLE carts TO shopsphere_assistant_private_runtime;
