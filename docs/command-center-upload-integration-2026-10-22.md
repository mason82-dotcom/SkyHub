# Integration der hochgeladenen Command-Center-Entwürfe (22.10.2026)

## Ausgangsbasis und Umfang

Branch `feature/command-center-readonly-20261022` ist auf
`develop/skyhub-integrated-readonly-20261022` (Commit `ce71f19`)
aufgebaut, nicht auf dem älteren Stand von `main`.
Das vorhandene Dashboard, die DJI Cloud API 1.18, MQTT-Verarbeitung,
TSA/Pilot-2-Pairing, MinIO-Konfiguration und die WPML-Generatoren
bleiben unersetzt.

Neu: `/command-center.html`, erreichbar über den Link im bisherigen
Dashboard. Kein Build-Schritt und keine geänderten Backend-Routen.
Die Oberfläche verwendet `/api/devices`, `/api/health`,
Socket.IO (`snapshot` und `device_update`) sowie die schon bestehenden,
optionalen **lesenden** `/api/media/*`-Endpunkte. Berechtigung wie
bisher: Token im Arbeitsspeicher der Seite oder konfigurierte
LAN-Leseausnahme. Kein Token in einer URL, Browser-Speicherung oder
MQTT-Steuerbefehl.

## Zuordnung der neun Uploads

| Upload | Umsetzung |
|---|---|
| SkyHub Next - Command Center.html | Dashboard-/Modul-Layout als eigenständige, nicht simulierende Command-Center-Ansicht adaptiert |
| SkyHub Frontend.html | Medienfilter, Metadatendarstellung und Navigation als gestalterische Referenz; keine Mock-Fotos |
| SkyHub Application Index (5).html | Karten-/Missionen-Konzept über das vorhandene Karten-/WPML-System angebunden, statt zweiten Editor einzuführen |
| DJI WPML Generator.js | Nicht übernommen: `downloadKMZ` enthält nur auskommentierten ZIP-Code und verwendet ungeprüfte Enum-Werte |
| DJI WPML Generator (1).js | Identisches Duplikat der anderen Generator-Datei; dieselbe Entscheidung |
| React Echtzeit-Hook.txt | An die bestehenden Socket.IO-Events angepasst, **keine** fingierte `isConnected=true`-Verbindung |
| Redis Job Queue Adapter.js | Nicht aktiviert: unvalidierte Auftragsdaten, schluckt Einreihungsfehler, ohne Verarbeitungs-/Betriebsfreigabe |
| Python Worker Daemon.py | Nicht aktiviert: `BLPOP` quittiert Jobs vor Erfolg; bestehende Analyse-Worker sind teilweise synthetisch |
| DJI Cloud API Storage Endpoints.js | Nicht übernommen: ungeschützte statische S3-Schlüssel und nicht dokumentationskonforme Upload-Pfade. Gesicherter `media-upload-contract.js` bleibt entkoppelt |

## Funktionsnachweise und Grenzen

- Kein erfundener Akku-, RTK-, HMS-, FPV- oder Analysewert.
- Live-Kennzeichnung nur bei tatsächlich kürzlich übermittelter OSD;
  je Messwert separate Frische und ungeprüfte DJI-Zeit.
- 0/0-Position wird nicht auf der Karte angezeigt; alte Positionen
  unterscheiden sich visuell. Karte bewegt sich zu einer Geräteposition
  nur nach expliziter Auswahl.
- M3M-Inventur zeigt ausschließlich whitelisted Dateinamen-Zähler.
  **Keine** radiometrische Freigabe / NDVI / NDRE / VRA / ISO-XML.
- MinIO-Status und Bucket-/Objektlisten sind nur bei aktivierter
  `SKYHUB_MEDIA_ENABLED=true`-Konfiguration verfügbar. Die neue
  Oberfläche aktiviert das Flag nicht, lädt keine Mediendateien und
  gibt keine Credentials oder signierten URLs heraus.
- WPML ist weiterhin **Offline-Entwurf**, nicht Flugfreigabe:
  Links führen zu bestehenden, getesteten `wpml-editor.html` und
  `wpml-survey-preview.html`. `flightReady=false` bleibt bestehen.
- Kein automatischer Redis-Job, keine echten Analyse-Workerstarts,
  keine Drone Upload-/Control-Endpunkte, keine DB-Migration,
  keine Pi-Änderung und kein Docker-/MinIO-Neustart.

## Test / Abnahme

```sh
cd backend
npm ci
npm test
node --test test/command-center-core.test.js test/command-center-page.test.js
```

Mit dem neuen Branch ausschließlich den Quellcode prüfen;
ein Pi-Deployment oder echter FPV-/DJI-Upload ist **nicht** damit bestätigt.
Externe OSM-/Leaflet-Kartenressourcen benötigen Netzverbindung.
