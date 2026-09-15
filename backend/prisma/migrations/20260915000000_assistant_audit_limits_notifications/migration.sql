CREATE TABLE assistant_audit_events (
  id uuid PRIMARY KEY,
  "traceId" varchar(100) NOT NULL,
  layer varchar(20) NOT NULL,
  "subjectId" varchar(24),
  role varchar(20),
  "clientId" varchar(200),
  "workloadId" varchar(200),
  "grantId" varchar(200),
  "policyVersion" varchar(50) NOT NULL,
  tool varchar(100),
  operation varchar(100) NOT NULL,
  "authorizationOutcome" varchar(30) NOT NULL,
  outcome varchar(50) NOT NULL,
  "redactedInput" jsonb NOT NULL,
  "returnedFields" text[] NOT NULL DEFAULT '{}',
  "resourceIds" text[] NOT NULL DEFAULT '{}',
  "responseDigest" varchar(100),
  "responseBytes" integer,
  "rowCount" integer,
  "latencyMs" integer NOT NULL CHECK ("latencyMs" >= 0),
  "failureReason" varchar(100),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_audit_events_trace_idx ON assistant_audit_events ("traceId");
CREATE INDEX assistant_audit_events_subject_time_idx ON assistant_audit_events ("subjectId", "createdAt");
CREATE INDEX assistant_audit_events_operation_outcome_time_idx ON assistant_audit_events (operation, outcome, "createdAt");

CREATE FUNCTION shopsphere_reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'assistant audit events are append-only';
END
$$;
CREATE TRIGGER assistant_audit_events_no_update
  BEFORE UPDATE OR DELETE ON assistant_audit_events
  FOR EACH ROW EXECUTE FUNCTION shopsphere_reject_audit_mutation();

GRANT INSERT ON assistant_audit_events TO shopsphere_assistant_runtime;

GRANT SELECT (id, "userId", type, title, message, read, "productId", "productName", "createdAt")
  ON notifications TO shopsphere_assistant_runtime;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopsphere_assistant_notification_self ON notifications;
CREATE POLICY shopsphere_assistant_notification_self ON notifications
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    "userId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller', 'admin')
    AND current_setting('shopsphere.operation', true) = 'notifications.listMine'
  );

DO $$
DECLARE
  owner_name text;
BEGIN
  SELECT tableowner INTO owner_name FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'notifications';
  DROP POLICY IF EXISTS shopsphere_application_owner ON notifications;
  EXECUTE format(
    'CREATE POLICY shopsphere_application_owner ON notifications TO %I USING (true) WITH CHECK (true)',
    owner_name
  );
END
$$;

