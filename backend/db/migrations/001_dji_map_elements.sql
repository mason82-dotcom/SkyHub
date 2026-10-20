-- Draft only: not loaded by server startup and not applied to any database.
-- Apply only after a separate test-database migration and recovery review.
CREATE TABLE IF NOT EXISTS dji_map_element_groups (
    workspace_id UUID NOT NULL,
    group_id VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    group_type SMALLINT,
    is_locked BOOLEAN,
    create_time BIGINT,
    PRIMARY KEY (workspace_id, group_id),
    CHECK (group_type IS NULL OR group_type IN (0, 1, 2)),
    CHECK (create_time IS NULL OR create_time >= 0)
);

CREATE TABLE IF NOT EXISTS dji_map_elements (
    workspace_id UUID NOT NULL,
    group_id VARCHAR(128) NOT NULL,
    element_id VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    resource_type SMALLINT,
    geometry JSONB NOT NULL,
    color VARCHAR(7),
    clamp_to_ground BOOLEAN,
    is_3d BOOLEAN,
    create_time BIGINT,
    update_time BIGINT,
    PRIMARY KEY (workspace_id, group_id, element_id),
    FOREIGN KEY (workspace_id, group_id)
      REFERENCES dji_map_element_groups (workspace_id, group_id),
    CHECK (resource_type IS NULL OR resource_type IN (0, 1, 2)),
    CHECK (jsonb_typeof(geometry) = 'object'),
    CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
    CHECK (create_time IS NULL OR create_time >= 0),
    CHECK (update_time IS NULL OR update_time >= 0)
);

CREATE INDEX IF NOT EXISTS idx_dji_map_elements_workspace_group
  ON dji_map_elements (workspace_id, group_id);
