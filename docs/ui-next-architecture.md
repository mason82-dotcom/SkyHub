# SkyHub NEXT – Integrationsarchitektur & Release-Roadmap

## 1. Systemgrenzen

DJI Cloud API Demo (Java 11 / Spring Boot 2.7 / Redis / MQTT / WebSocket / MySQL) ist **nur Referenz** für DJI-Flows; Wartung seit 2025 eingestellt. Die Implementierung wird modulweise an SkyHub NEXT angebunden, nicht blind in die Demo zurückportiert.

```
              DJI Pilot 2 / RC / Aircraft
                | HTTPS + MQTT + WebSocket
                v
         Auth + Device Topology Adapter
                |
          Telemetry Normalizer ----> Per-field provenance + freshness store
                |                           |
                v                           v
          Operations API ------------> Realtime SSE/WS Gateway
                |                           |
                +------ Mission API ------ Web Client (Karte, Editor, QA)
                |         |                 |
                |         v                 v
                |     WPML Writer      Media/Survey/Thermal/Farm
                |      Validator          Jobs + Results
                |         |                 |
                v         v                 v
        Event/Job Queue & Postgres/PostGIS + MinIO Objects
                |
          Dedicated analysis workers
          ├─ EXIF / XMP / thumbnails / QA
          ├─ DJI Thermal SDK (native Linux, R-JPEG)
          ├─ Photogrammetry (SfM / DSM / DTM / orthomosaic)
          └─ Multispectral calibration / mosaics / vegetation indices
```

### Telemetrie-Datenvertrag

Jeder Datensatz: `device_id`, `gateway_id`, `source_topic`, `channel` (`osd|state|derived`), `observed_at`, `received_at`, `value`, `unit`, `freshness`, `reason`, `schema_version`.

- **Geräte:** aircraft state/OSD, RC OSD/state, Payloads, Topology, Flight status, Pilot-2-Login.
- **GNSS/RTK:** Position, horizontal/vertical accuracy (falls verfügbar), Satelliten, GNSS-Fix, RTK mode/status, heading.
- **Flugzustand:** home point, altitude reference (`AGL|AMSL|relative`), speed xyz, orientation pitch/roll/yaw, RTH height/status, failsafe, flight mode.
- **Energie:** aircraft/payload/RC battery percent, voltage, current, cell details, cycles, temp, remaining time (nur wenn vom Gerät geliefert).
- **Verbindung:** RSSI/Link state, MQTT subscribe state, ACK latency, last message age, WebSocket topology state, uplink/downlink, bitrate (nur wenn verfügbar).
- **Kamera:** mode, zoom, pitch/yaw, recording, storage, active camera, thermal configuration.
- **Unsicherheit:** Nicht von einem unvollständigen `state`-Kanal auf fehlende `osd`-Werte schließen. Fehlende Telemetrie als `unknown` darstellen, niemals `0` oder `online` erfinden.

Die echte DJI Property-Liste muss pro Zielmodell aus der DJI Thing-Model-Dokumentation gemappt werden. Veraltete Felder werden nach konfigurierbaren TTLs abgestuft zu `stale`, dann `unknown`. Kein Remote-Control-Button bei inaktiver Auth oder nicht unterstütztem Device-Feature.

## 2. Mission Studio – WPML-Konformität

### Datenmodell

Persistiert einen editierbaren Draft mit GeoJSON-geometrie (WGS84), Waypoints, Kamera-Aktionsgruppen, Height-Mode, Höhenreferenz, Geräteprofil, RTH, Sicherheitsabständen und Ausführungsparametern. `template.kml` und `waylines.wpml` entstehen **aus demselben normalisierten Mission-AST**. Jeder Export wird nach Schema-/Feldreferenz geprüft und mit Hash/Audit-Trail gespeichert.

### UI

- Tool-Modi: Wegpunkte, Polygon, Grid, Double-grid, Korridor, Fassade, POI; Drag-and-drop; Snap/Grid-Abstände.
- Konfigurierbar: Höhe, Geschwindigkeit, RTH, Abstand zu Objekten, Abstand zwischen Streifen, Front-/Seitenüberlappung, Kameraausrichtung, Gimbal, Aktionsintervall, Windannahmen.
- Kartenschichten: Satellit/Straße, digitale Höhenmodelle, Missionsoverlays, GeoJSON/GeoTIFF/COG, Stations-/RTK-Karte, GCP, Wegpunkt-Nummern, Geländeschnitt, optional genehmigte Geofences.
- Export-/Statusphasen: `DRAFT` → `FORMAT_VALIDATED` → `DEVICE_COMPATIBLE` → `OPERATIONS_REVIEWED` → `FLIGHT_AUTHORIZED`. Diese Prototypversion endet **immer** bei `DRAFT` und formaler Eingabevalidierung.

**Abnahmekriterien:** official DJI WPML field validations per airframe and firmware; golden KMZ fixtures; Pilot 2 import round-trip; actual payload photo actions; real controlled hardware tests. Keine `flightReady=true`-Freigabe ohne unabhängiges Gate.

## 3. Media Intelligence

### Speicherung

MinIO / S3 versionierter, objektbasierter Upload mit Checksums und Protokollierung: `flight_id`, `asset_id`, `sha256`, `original_key`, `immutable`, `sensor`, `bands`, `metadata_version`, `processing_job`, `quality_flags`. Datensichtbarkeit rollenbasiert, keine GPS/Seriennummern ungefragt in Logs.

### Metadaten pro Asset

- Original: `MediaFile`, Dateiname, MIME, Größe, Hash, Zeitpunkt, Kamera-/Softwareversion.
- EXIF: DateTimeOriginal, Serial-/Model-Felder (geschützt), ExposureTime, FNumber, ISO, FocalLength, WhiteBalance, Lens, JPEG/TIFF dimensions, GPS IFD.
- XMP DJI: AbsoluteAltitude, RelativeAltitude, FlightYaw/Pitch/Roll, GimbalYaw/Pitch/Roll, Calibrated* Werte, RTK status, capture sync, camera intrinsics, distortion/dewarp coefficients, timestamps.
- DJI M3M: Zuordnung RGB + Green/Red/RedEdge/NIR **aller Originaldateien**, Wellenlängen, TIFF-Nodaten, Black-Level, Vignette, Irradiance/Sunlight-Sensor, band geometry, alignment quality, interpolation, reflectance model.
- DJI Thermal: R-JPEG, IR-camera serial/calibration metadata, emissivity, distance, humidity, reflected temperature, spot/ROI measurements, QA flag for radiometric validity. Temperaturraster wird erst nach TSDK-Verarbeitung belegt.
- Engineering: EXIF/XMP-Tag-Key + Namespace + raw value + normalized value + unit + origin + trust status separat speichern. Keine unbekannten Tags stillschweigend verwerfen – in separater sicherer Detailansicht unter Größenlimits anzeigen.
- UI: Ansicht Raster/Liste/Karte, Raw/Normalized/Derived Tabs, Metadatenvergleich, Bilder synchron auf Karte lokalisieren, Flight-ID/Time Range/Camera/RTK/Quality-Filter, S3 exports.

## 4. Survey M3E

Input: M3E RGB + RTK / GCP / Checkpoints. Processing: Photo ingest → camera intrinsics/EXIF QA → image matching → SfM/bundle adjustment → geo adjustment → dense cloud → DSM/DTM → orthomosaic → elevation/volume workflows.

Output: COG GeoTIFF orthomosaic, DSM/DTM, LAS/LAZ, height contours, textured meshes, Cut/Fill reports, 2D/3D GIS viewer. Persist CRS/EPSG, vertical datum, units, GSD, validation RMSE and GCP/checkpoint residuals. **Do not claim centimeter accuracy from RTK labels alone.**

## 5. Thermal M3T / M4T

Dedicated Linux native DJI Thermal SDK worker (SDK license/ABI/runtime to check, not browser JS). Per R-JPEG: decode calibrated temperature raster, correction for emissivity/reflection/distance/humidity, confidence/quality; extract polygons/ROIs; overlay visible+thermal; store thermal measurement geospatial footprints.

- PV: per-cell anomalies, comparative module ΔT, bypass-diode patterns, reflections, roof/ground occlusions, repeatable report and severity based on defined conditions.
- Building: thermal envelope, cold bridges, insulation/anomaly clusters, interior-exterior gradient, wind/sun history, surface reflection/heterogeneous emissivity caveats; **no guaranteed insulation diagnosis from thermal image alone**.

## 6. Smart Farming M3M

Use four independent spectral TIFF bands (G / R / RE / NIR) plus 20MP RGB – not only visually colorized composites. Orthorectification / radiometric calibration first, co-registration and quality gates next.

Formulae (reflectance values):

- NDVI = (NIR − R) / (NIR + R)
- NDRE = (NIR − RE) / (NIR + RE)
- GNDVI = (NIR − G) / (NIR + G)
- OSAVI = 1.16 × (NIR − R) / (NIR + R + 0.16)

Handle division-by-zero, NoData, low-light, calibration uncertainty, clouds/shadows, varying acquisition time and saturation. Analyze parcel management zones, temporal differences, canopy fraction, bare-soil masking, statistics by polygon, agronomic export GeoTIFF/CSV/GeoJSON/ISOXML where validated.

**Soil moisture, nutrients, compaction and chemical properties require ground measurements or separate sensors.** Spectral proxies must be marked as model estimates, not measurements.

## 7. Milestone sequencing

| Stage | Deliverables | Acceptance Gate |
|---|---|---|
| P0 – UI | Operations / map / missions / media / industry pages | This prototype + browser tests |
| P1 – Platform | Authentication, DJI 1.18 protocol adapter, live MQTT OSD/state + WS topology, RBAC, log masking | Replay fixtures + RC/M4T/M3E/M3M hardware tests |
| P2 – Missions | Full WPML schema, safety review, mapping/corridor/Façade, golden KMZ round-trips, mission upload behind authorization | Pilot 2 device-specific import/field tests |
| P3 – Media | MinIO original files, resumable ingestion, EXIF/XMP full-index, integrity, metadata filters, job queue | Reproducible image-and-metadata QA |
| P4 – Survey | SfM pipeline, RTK/GCP QA, orthos/DSM/DTM/3D/volume | Independent positional accuracy checks |
| P5 – Thermal | DJI native SDK adapter, PV/building classifiers, reports | Calibrated R-JPEG fixtures and reference measurements |
| P6 – Farming | M3M TIFF band handling, reflectance, indices, parcel stats and seasonal compare | Calibration and field ground truth |

## 8. Deployment

Pi: device connectivity, DJI protocol adapters, auth, telemetry normalization, local MinIO. External high-core-count worker or VPS for large SfM/CV jobs if needed, constrained by storage transfer cost/egress and data protection. Use Redis/job queue for async processing with idempotency. PostGIS for geospatial footprints; GeoParquet/COG for raster processing. Keep TSDK licensing and safe binary isolation separate from public web service.

Deploy only after adding TLS, RBAC, server auth, WebSocket origin restrictions, payload validation, rate limits, secret rotation, provenance/masking, audit trail, backups, and flight authorization workflow.
