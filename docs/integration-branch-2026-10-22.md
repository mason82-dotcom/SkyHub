# SkyHub Next – isolierter Integrationsbranch (22.10.2026)

## Geltungsbereich

Dieser Branch basiert auf `fix/tsa-trusted-proxy-reconnect-20261022` (Commit `5d28291`),
welcher wiederum auf der veröffentlichten Pi-Feature-Basis `bbded73` aufbaut.
`main`, der produktive Raspberry-Pi-Checkout, EMQX, Caddy, PostGIS, Redis und MinIO
wurden für diese GitHub-Integration **nicht** verändert.

Diese Integration ist ein **additiver Source-Checkout** und ausdrücklich
**keine Pi-Deployment- oder Hardware-Freigabe**.

## Übernommene, voneinander isolierte Komponenten

1. **TSA/Pilot 2:** Vorhandener Quellcode und Regressionstests aus PR #28
   bleiben unverändert. TSA ist opt-in; die TLS-Proxy-Peer-IP und die
   Weitergabe von WebSocket-Token in URL-Querystrings sind vor einem
   realen Betrieb gesondert zu verifizieren.
2. **DJI WPML (PR #16):** Offline-KMZ-Parser, Validierung, Vergleich,
   einfache Missionsentwürfe, Browser-Vorschau und Tests.
   Die serverseitige WPML-Upload-Route wurde **nicht** aus einem alten
   `server.js` übernommen. Die statischen Browserseiten sind
   Offline-Entwurfswerkzeuge, **keine** Freigabe für Pilot-2-Import,
   Flugsteuerung oder Wayline-Execution.
   `flightReady=false` bleibt das verpflichtende Ergebnis.
3. **MinIO-Abnahmewerkzeuge (PR #25):** Eigener Ordner
   `pi-minio-acceptance/` plus CI-Fixture-Workflow. Diese Werkzeuge
   können verschlüsselte Backups und isolierte Restores unterstützen,
   dürfen jedoch **nicht** ohne gesonderte Betriebsfreigabe ausgeführt werden.
   Ältere Runbook-Angaben zu Commitständen und noch nicht gestarteten
   Schritten sind historische Momentaufnahmen, keine neue Freigabe.
4. **RC Plus 2/Matrice 4T und M3M (PR #27):** Zusätzliche
   lesende Hardwarediagnose-Module und Tests sowie ein separater
   Pi-CLI-Check. Keine neuen MQTT-Abos, keine gerätebezogenen
   Schreibaktionen, keine Änderung an Backend-Parser oder Registry.
   Matrice-4T-Statistik auf den aktuellen Katalog mit **202 statischen
   Feldpfaden** statt historisch 199 abgestimmt.

## Bestehende reale Nachweise

- RC Pro Enterprise + Mavic 3M: Pilot-2-Pairing, MQTT, Topologie,
  Live-OSD, feldweise DJI-Telemetrie.
- RC Plus 2 Enterprise + Matrice 4T: erfolgreiches Pairing,
  Live-OSD, dokumentierte GNSS/RTK- und Gimbal-Feldbeobachtungen.
- Vorhandene M3M-/MinIO-Lesetests: 424 Objekte im explizit ausgewählten
  S3-Prefix, acht TIFF-XMP-Analysen mit R=4 und NIR=4.
  Keine radiometrische NDVI-/NDRE-Bereitschaft.

Quellen: [RC/M3M Hardware](hardware-rc-pro-m3m.md),
[DJI-1.18-Feldabgleich](dji-118-field-audit.md) und
[M3M-MinIO-Hardware-Smoke](smart-farming-m3m-s3-hardware-smoke.md).

## Nicht übernommen, um Regressionen zu verhindern

- Keine älteren Fassungen von `backend/server.js`, `backend/registry.js`,
  `backend/dji-properties.js`, `backend/data/dji-cloud-api-118-fields.json`,
  `backend/package-lock.json` oder `docker-compose.yml`.
- Keine automatische Änderung von `main`, keine Änderung produktiver
  Volumes, keine Backups/Restores auf dem Pi, kein Deployment.
- Keine WPML-Cloud-Upload-/Flugsteuerungsrouten, keine MinIO-Write-API.
- Nicht übernommen sind alte Hardware-Konsolidierungs-Integrationstests,
  sofern sie die ältere Parser-/Katalogschnittstelle voraussetzen.

## Abnahmeschranken

1. GitHub-CI: Node.js-Tests, isolierte PostGIS-/Restore-Tests,
   Compose-Syntax, ARM64-Overlay, Docker-Build.
2. Separate MinIO-Fixture-Tests unter `pi-minio-acceptance/` über
   den dafür vorgesehenen Workflow.
3. Änderungen an Cloud-/Pilot-/Media-HTTP-Endpunkten gesondert prüfen;
   WPML-Entwürfe werden nicht automatisch als Flugmission aktiviert.
4. Pi-Deployment und Hardware-Nachprüfung nur für tatsächlich neue
   Funktionen, getrennt vom Branch-Merge und mit eigener Freigabe.

Aktuelle Branch-Abhängigkeiten: PR #24 (Feature-Basis) → PR #28 (TSA-Sicherheit)
→ dieser Integrationsbranch. PR #16/#25/#27 bleiben unabhängige
Quellbranches, bis die Integration einzeln reviewed ist.
