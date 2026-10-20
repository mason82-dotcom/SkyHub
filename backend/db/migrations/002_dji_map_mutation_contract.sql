-- Draft-only P2 migration. Never applied by the backend or Docker startup.
-- Requires 001_dji_map_elements.sql in a reviewed isolated database.
ALTER TABLE dji_map_elements
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

-- The audit log survives element deletion. Group deletion is forbidden by the FK.
CREATE TABLE IF NOT EXISTS dji_map_element_audit (
  audit_id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL,
  group_id VARCHAR(128) NOT NULL,
  element_id VARCHAR(128) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  action VARCHAR(8) NOT NULL CHECK (action IN ('create','update','delete')),
  old_revision BIGINT,
  new_revision BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id, group_id)
    REFERENCES dji_map_element_groups (workspace_id, group_id),
  CHECK (old_revision IS NULL OR old_revision >= 1),
  CHECK (new_revision IS NULL OR new_revision >= 1)
);
CREATE INDEX IF NOT EXISTS idx_dji_map_audit_workspace_group_time
  ON dji_map_element_audit (workspace_id, group_id, created_at DESC);

-- A previous unsuccessful migration could leave a column without constraints:
-- do not silently accept negative revisions.
DO $skyhub$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dji_map_elements_revision_positive'
      AND conrelid = 'dji_map_elements'::regclass
  ) THEN
    ALTER TABLE dji_map_elements
      ADD CONSTRAINT dji_map_elements_revision_positive CHECK (revision >= 1);
  END IF;
END
$skyhub$;

-- Make the audit journal append-only for the application database role.
-- A privileged DB owner can still alter triggers: operational role separation
-- and independent backup retention are separate security requirements.
CREATE OR REPLACE FUNCTION skyhub_map_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $skyhub$
BEGIN
  RAISE EXCEPTION 'DJI map audit history is immutable' USING ERRCODE = '42501';
  RETURN NULL;
END;
$skyhub$;

DROP TRIGGER IF EXISTS dji_map_audit_no_rewrite ON dji_map_element_audit;
CREATE TRIGGER dji_map_audit_no_rewrite
  BEFORE UPDATE OR DELETE ON dji_map_element_audit
  FOR EACH ROW EXECUTE FUNCTION skyhub_map_audit_immutable();
DROP TRIGGER IF EXISTS dji_map_audit_no_truncate ON dji_map_element_audit;
CREATE TRIGGER dji_map_audit_no_truncate
  BEFORE TRUNCATE ON dji_map_element_audit
  FOR EACH STATEMENT EXECUTE FUNCTION skyhub_map_audit_immutable();
