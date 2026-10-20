-- Synthetic fixtures only; executed in an ephemeral database named skyhub_test.
INSERT INTO dji_map_element_groups
  (workspace_id, group_id, name, group_type, is_locked, is_distributed)
VALUES
  ('e3dea0f5-37f2-4d79-ae58-490af3228069', 'shared', 'Synthetic Shared A', 2, false, true),
  ('e3dea0f5-37f2-4d79-ae58-490af3228069', 'empty', 'Synthetic Empty A', 2, false, true),
  ('203cc94c-aef1-4e0e-a520-05a24be33a31', 'shared', 'Synthetic Shared B', 2, false, true);

INSERT INTO dji_map_elements
  (workspace_id, group_id, element_id, name, resource_type, geometry, color,
   clamp_to_ground, is_3d, create_time, update_time)
VALUES
  ('e3dea0f5-37f2-4d79-ae58-490af3228069', 'shared', 'marker', 'A marker', 0,
   '{"type":"Point","coordinates":[8.4,49.1]}'::jsonb, '#0091FF', true, false,
   1760000000000, 1760000001000),
  ('203cc94c-aef1-4e0e-a520-05a24be33a31', 'shared', 'marker', 'B marker', 0,
   '{"type":"Point","coordinates":[9.4,50.1]}'::jsonb, '#FF0000', false, false,
   1760000000000, 1760000001000);

INSERT INTO drone_telemetry
  (gateway_sn, device_sn, latitude, longitude, altitude, battery_percentage,
   geom, source_ts, time_verified, height_ellipsoid, gps_satellites)
VALUES
  ('SYNTHETIC_RC', 'SYNTHETIC_AIRCRAFT', 49.1, 8.4, 120.5, 76,
   ST_SetSRID(ST_MakePoint(8.4, 49.1), 4326),
   to_timestamp(1760000000), true, 121.5, 19);
