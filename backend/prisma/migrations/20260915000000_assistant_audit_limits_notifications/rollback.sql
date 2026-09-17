DROP POLICY IF EXISTS shopsphere_assistant_notification_self ON notifications;
DROP POLICY IF EXISTS shopsphere_application_owner ON notifications;
ALTER TABLE notifications NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
REVOKE SELECT (id, "userId", type, title, message, read, "productId", "productName", "createdAt")
  ON notifications FROM shopsphere_assistant_runtime;
DROP TRIGGER IF EXISTS assistant_audit_events_no_update ON assistant_audit_events;
DROP FUNCTION IF EXISTS shopsphere_reject_audit_mutation();
DROP TABLE IF EXISTS assistant_audit_events;
