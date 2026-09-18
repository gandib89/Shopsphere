-- Assistant proposal platform for #22 (PostgreSQL 16).
--
-- proposals holds the canonical, payload-immutable cart-change proposal. The
-- assistant private runtime may INSERT a proposal for its own subject and
-- SELECT its own rows; every other transition (executed/expired/stale/rejected,
-- plus the cart mutation itself) runs as the application owner through the
-- first-party browser endpoint, which bypasses RLS via the owner policy below.
-- That split is deliberate: delegated assistant credentials can never move a
-- proposal out of pending.
--
-- proposal_outbox_events is an append-only outcome log written in the same
-- transaction as the proposal write or cart mutation.

CREATE TABLE proposals (
  id varchar(24) PRIMARY KEY,
  "subjectId" varchar(24) NOT NULL,
  role varchar(20) NOT NULL,
  "clientId" varchar(200) NOT NULL,
  "grantId" varchar(200) NOT NULL,
  "actionKind" varchar(40) NOT NULL,
  "targetType" varchar(20) NOT NULL,
  "targetId" varchar(24),
  "canonicalPayload" jsonb NOT NULL,
  preview jsonb NOT NULL,
  "expectedVersion" integer NOT NULL,
  "payloadHash" varchar(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  "expiresAt" timestamptz NOT NULL,
  "executedAt" timestamptz,
  "executionReference" varchar(100),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL
);

CREATE INDEX proposals_subject_time_idx ON proposals ("subjectId", "createdAt");
CREATE INDEX proposals_status_expiry_idx ON proposals (status, "expiresAt");

-- Payload immutability: subject/role/client/grant, target, canonical payload,
-- preview, expected version, and hash can never change after INSERT. Status and
-- the execution columns may transition (pending -> executed/expired/stale/rejected).
CREATE FUNCTION shopsphere_reject_proposal_payload_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."subjectId" IS DISTINCT FROM OLD."subjectId"
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW."clientId" IS DISTINCT FROM OLD."clientId"
     OR NEW."grantId" IS DISTINCT FROM OLD."grantId"
     OR NEW."actionKind" IS DISTINCT FROM OLD."actionKind"
     OR NEW."targetType" IS DISTINCT FROM OLD."targetType"
     OR NEW."targetId" IS DISTINCT FROM OLD."targetId"
     OR NEW."canonicalPayload" IS DISTINCT FROM OLD."canonicalPayload"
     OR NEW.preview IS DISTINCT FROM OLD.preview
     OR NEW."expectedVersion" IS DISTINCT FROM OLD."expectedVersion"
     OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" THEN
    RAISE EXCEPTION 'proposal payload columns are immutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER proposals_payload_immutable
  BEFORE UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION shopsphere_reject_proposal_payload_mutation();

CREATE TABLE proposal_outbox_events (
  id uuid PRIMARY KEY,
  "proposalId" varchar(24) NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  "eventType" varchar(20) NOT NULL,
  "payloadHash" varchar(64) NOT NULL,
  "occurredAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX proposal_outbox_events_proposal_time_idx
  ON proposal_outbox_events ("proposalId", "occurredAt");

CREATE FUNCTION shopsphere_reject_outbox_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'proposal outbox events are append-only';
END
$$;
CREATE TRIGGER proposal_outbox_events_append_only
  BEFORE UPDATE OR DELETE ON proposal_outbox_events
  FOR EACH ROW EXECUTE FUNCTION shopsphere_reject_outbox_mutation();

-- Restricted assistant runtime role (same hardening baseline as the earlier
-- assistant migrations; no-op when the role already exists).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shopsphere_assistant_private_runtime') THEN
    CREATE ROLE shopsphere_assistant_private_runtime NOLOGIN;
  END IF;
END
$$;

-- Column-scoped grants: exactly what proposals.proposeCartChange writes and
-- proposals.actionStatus reads. The INSERT grant must include "updatedAt"
-- because the Prisma client supplies it on every create. No grant on
-- proposal_outbox_events exists: the assistant path never reads or writes the
-- outbox.
GRANT SELECT (id, "subjectId", role, "clientId", "grantId", "actionKind", "targetType", "targetId",
              "expectedVersion", status, "expiresAt", "executedAt", "createdAt")
  ON TABLE proposals TO shopsphere_assistant_private_runtime;
GRANT INSERT (id, "subjectId", role, "clientId", "grantId", "actionKind", "targetType", "targetId",
              "canonicalPayload", preview, "expectedVersion", "payloadHash", status, "expiresAt", "updatedAt")
  ON TABLE proposals TO shopsphere_assistant_private_runtime;

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopsphere_assistant_proposals_subject ON proposals;
CREATE POLICY shopsphere_assistant_proposals_subject ON proposals
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.actionStatus')
  );

DROP POLICY IF EXISTS shopsphere_assistant_proposals_insert ON proposals;
CREATE POLICY shopsphere_assistant_proposals_insert ON proposals
  FOR INSERT TO shopsphere_assistant_private_runtime
  WITH CHECK (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) = 'proposals.proposeCartChange'
  );

-- Owner preservation under FORCE RLS: the first-party execution path runs as
-- the normal application owner (browser JWT, no delegated credential), which is
-- allowed to read, insert, and update proposals to drive exactly-once
-- execution. This bypass is intended and documented in #22.
DO $$ DECLARE owner_name text; BEGIN
  SELECT tableowner INTO owner_name FROM pg_tables WHERE schemaname='public' AND tablename='proposals';
  DROP POLICY IF EXISTS shopsphere_application_owner ON proposals;
  EXECUTE format('CREATE POLICY shopsphere_application_owner ON proposals TO %I USING (true) WITH CHECK (true)', owner_name);
END $$;

-- Proposal creation previews the cart, so the proposal operation must be able
-- to read the buyer cart rows (the column grants from the #12 migration cover
-- every projected column; the new version column is granted in migration
-- 20260919050001_cart_version, which adds it). Extend the cart/cart_item
-- policies with the proposal operation.

DROP POLICY IF EXISTS shopsphere_assistant_cart_self ON carts;
CREATE POLICY shopsphere_assistant_cart_self ON carts
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "userId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('cart.getMine', 'cart.validatePromo', 'cart.previewCheckout', 'proposals.proposeCartChange')
  );

DROP POLICY IF EXISTS shopsphere_assistant_cart_item_self ON cart_items;
CREATE POLICY shopsphere_assistant_cart_item_self ON cart_items
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    EXISTS (
      SELECT 1 FROM carts
      WHERE carts.id = cart_items."cartId"
        AND carts."userId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('cart.getMine', 'cart.validatePromo', 'cart.previewCheckout', 'proposals.proposeCartChange')
  );
