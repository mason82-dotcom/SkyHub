-- Exit with an error if an actual pg_dump/pg_restore loses schema or fixture data.
DO $skyhub$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE EXCEPTION 'PostGIS extension missing after restore';
  END IF;

  IF (SELECT count(*) FROM dji_map_element_groups) <> 3 THEN
    RAISE EXCEPTION 'DJI map group row count mismatch';
  END IF;
  IF (SELECT count(*) FROM dji_map_elements) <> 2 THEN
    RAISE EXCEPTION 'DJI map element row count mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM dji_map_element_groups
    WHERE workspace_id = 'e3dea0f5-37f2-4d79-ae58-490af3228069'
      AND group_id = 'empty' AND group_type = 2
  ) THEN
    RAISE EXCEPTION 'Empty App Shared group missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM dji_map_elements
    WHERE workspace_id = 'e3dea0f5-37f2-4d79-ae58-490af3228069'
      AND group_id = 'shared' AND element_id = 'marker'
      AND geometry = '{"type":"Point","coordinates":[8.4,49.1]}'::jsonb
      AND create_time = 1760000000000
  ) THEN
    RAISE EXCEPTION 'Workspace A map element changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM dji_map_elements
    WHERE workspace_id = '203cc94c-aef1-4e0e-a520-05a24be33a31'
      AND group_id = 'shared' AND element_id = 'marker'
      AND geometry = '{"type":"Point","coordinates":[9.4,50.1]}'::jsonb
  ) THEN
    RAISE EXCEPTION 'Workspace B map element changed';
  END IF;

  IF (SELECT count(*) FROM drone_telemetry) <> 1 THEN
    RAISE EXCEPTION 'Flight track row count mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM drone_telemetry
    WHERE device_sn = 'SYNTHETIC_AIRCRAFT'
      AND latitude = 49.1 AND longitude = 8.4
      AND ST_SRID(geom) = 4326
      AND ST_X(geom) = 8.4 AND ST_Y(geom) = 49.1
      AND source_ts = to_timestamp(1760000000)
      AND time_verified = true AND gps_satellites = 19
  ) THEN
    RAISE EXCEPTION 'PostGIS geometry or flight telemetry changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_telemetry_geom'
  ) THEN
    RAISE EXCEPTION 'PostGIS telemetry GIST index missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dji_map_elements_workspace_id_group_id_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'Composite workspace/group FK missing';
  END IF;
END
$skyhub$;
