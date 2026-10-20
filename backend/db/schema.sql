CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Drohnen-Telemetrie und Verlauf
CREATE TABLE IF NOT EXISTS drone_telemetry (
    id SERIAL PRIMARY KEY,
    gateway_sn VARCHAR(100),
    device_sn VARCHAR(100) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    altitude DOUBLE PRECISION,
    battery_percentage INT,
    hms_codes JSONB,
    geom GEOMETRY(Point, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- Also added at startup for existing databases (backend/track-store.js).
    source_ts TIMESTAMPTZ,
    time_verified BOOLEAN,
    height_ellipsoid DOUBLE PRECISION,
    gps_satellites SMALLINT,
    rtk_satellites SMALLINT,
    rtk_fix_state SMALLINT,
    position_quality SMALLINT
);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time
  ON drone_telemetry (device_sn, created_at DESC);

-- 2. Leitstellen-Annotationen & Geofences (Situational Awareness)
CREATE TABLE IF NOT EXISTS map_annotations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    type VARCHAR(50), -- 'no_fly_zone', 'search_corridor', 'gcp_point'
    geom GEOMETRY(Geometry, 4326),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Agrar-Managementzonen für M3M (VRA-Düngekarten & ISO-XML Export)
CREATE TABLE IF NOT EXISTS agrar_management_zones (
    id SERIAL PRIMARY KEY,
    mission_id VARCHAR(64),
    zone_id INT, -- 0: Niedrige, 1: Mittlere, 2: Hohe Vitalität
    recommended_n_dose FLOAT, -- kg/ha Stickstoff-Düngeempfehlung
    index_type VARCHAR(16) DEFAULT 'NDVI', -- 'NDVI', 'NDRE', 'OSAVI', 'GNDVI'
    geom GEOMETRY(MultiPolygon, 4326)
);

-- 4. WPML-Flugaufträge & Status
CREATE TABLE IF NOT EXISTS flight_missions (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    gateway_sn VARCHAR(64) NOT NULL,
    mission_type VARCHAR(50) DEFAULT 'mapping2d', -- 'mapping2d', 'mapping3d_smart_oblique', 'gcp_inspection'
    exec_mode INT DEFAULT 0,
    kmz_s3_url TEXT NOT NULL,
    status VARCHAR(32) DEFAULT 'pending', -- 'pending', 'executing', 'completed', 'failed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Ground Control Points (GCPs) für M3E-Vermessungsgenauigkeit
CREATE TABLE IF NOT EXISTS ground_control_points (
    id SERIAL PRIMARY KEY,
    mission_id VARCHAR(64) REFERENCES flight_missions(id) ON DELETE CASCADE,
    code VARCHAR(32), -- z.B. 'GCP-01'
    target_altitude FLOAT,
    geom GEOMETRY(Point, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Medien-Assets & EXIF-Georeferenzierung
CREATE TABLE IF NOT EXISTS media_assets (
    id SERIAL PRIMARY KEY,
    gateway_sn VARCHAR(64) NOT NULL,
    mission_id VARCHAR(64),
    file_name VARCHAR(255) NOT NULL,
    s3_url TEXT NOT NULL,
    sensor_type VARCHAR(32), -- 'RGB', 'THERMAL_R_JPEG', 'MULTISPECTRAL_NIR'
    rtk_fix_status INT, -- 0: None, 16: Single, 50: Narrow Float, 68: RTK Fixed
    gimbal_pitch FLOAT,
    gimbal_yaw FLOAT,
    geom GEOMETRY(Point, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- GIST-Indizes für High-Performance Spatial Queries
CREATE INDEX IF NOT EXISTS idx_telemetry_geom ON drone_telemetry USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_annotations_geom ON map_annotations USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_agri_zones_geom ON agrar_management_zones USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_gcps_geom ON ground_control_points USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_media_geom ON media_assets USING GIST(geom);
