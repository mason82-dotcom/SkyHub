# SkyHub Next

**Version 0.1.0 – Entwicklungsstand.** Die Branch-Suffixe v1/v2/v3/v4 sind keine Produktversionen.

SkyHub Next ist die **aktive Entwicklungsbasis im Repository-Root**. Sie verarbeitet DJI-Cloud-API-Telemetrie mit Node.js/Express, Socket.IO, MQTT, Redis und PostGIS und stellt ein kompaktes statisches Live-Dashboard bereit. Im Main-Stand sind eine Medien-API, ein produktionsreifer Missionseditor und echte Analyse-Worker nicht enthalten; entsprechende Implementierungen in Feature-PRs sind noch nicht freigegeben. Der Root-Code ist **nicht automatisch identisch** mit dem aktuell auf dem Raspberry Pi betriebenen alten Dienst.

## Aktueller Projektstand (23.10.2026)

**Verbindliche Bestandsaufnahme:** [Projektstand, offene Entwicklungszweige und Integrationsgates](docs/projektstand-2026-10-23.md).
Die Main-Basis nach [#61](https://github.com/mason82-dotcom/SkyHub/pull/61) (HTTP-Fix), [#47](https://github.com/mason82-dotcom/SkyHub/pull/47) (synthetisches Protokollaudit) und [#66](https://github.com/mason82-dotcom/SkyHub/pull/66) (rein lesende Hardwarediagnostik) ist Commit
[`399e18900db11d976b61cc59a5cd8b081b6570e1`](https://github.com/mason82-dotcom/SkyHub/commit/399e18900db11d976b61cc59a5cd8b081b6570e1)
(vom 23.10.2026). Der nachfolgende Stand unterscheidet ausdrücklich **Main**,
**offene/gestapelte Pull Requests**, **in den Integrationsbranch gemergte PRs**,
**CI-Nachweise** und **Hardwarebeobachtungen**.

- **In Main:** DJI-MQTT-Leseeingang, Topologie/Registry, Pilot-2-HTTPS-Kopplung,
  statisches Dashboard, Feldfrische, HMS/Tracks, optionale begrenzte Topologie-Antwort
  und PostGIS-/Redis-Basis; außerdem die korrigierte DJI-Modell-Felddiagnose
  sowie den **nicht im Server gemounteten, synthetischen Offline-DJI-1.18-Paritätsaudit**.
  Zusätzlich **isolierte Offline-Hardwareprüfer** für RC Pro/M3M und RC Plus 2/M4T,
  M3M-Feldlücken-Klassifikation und synthetische Regressionen; die reale
  RC-Plus-2/M4T-Hardwareabnahme ist weiterhin ausstehend.
  Flugspuraufzeichnung bleibt standardmäßig aus.
- **Noch nicht in Main:** das neue Command Center, MinIO-Medienleser, Pilot-2-Medien-HTTPS/STS,
  sichere XMP-Proben, WPML-/KMZ-Offline-Inspektion, NDVI-/NDRE-Rasterexperimente,
  YOLO11, Thermal-Geolokalisierung und HiveMind-Simulationslabor.
  Teilkomponenten sind in offenen PRs beziehungsweise im separaten Integrationszweig.
- **Abgrenzung:** Ein Merge in `develop/skyhub-integrated-readonly-20261022`
  ist kein Merge nach `main`, und ein erfolgreicher CI-Lauf ist keine Pi-Installation
  oder DJI-Hardwarefreigabe. Kein Missionsversand, kein allgemeiner Sensor-Messwertnachweis.
- **Dokumentationsregel:** Historische Protokolle bleiben datiert; der verifizierte
  Stichtagsstand steht im verlinkten Integrationsregister.

## Projektstruktur

| Pfad | Zweck |
|---|---|
| `backend/` | Server, DJI-/MQTT-Adapter, Registry, Topologie, Pilot-Pairing, Track-Store und Tests |
| `frontend/public/` | Statische Dashboard- und Pilot-2-Oberfläche (kein Build-Schritt) |
| `scripts/` | Pi-Preflight, Diagnose, Backup und Cutover-Audit |
| `docs/` | Architektur, Sicherheit, Betrieb und Migrationskonzept |
| `docker-compose.yml` / `.env.example` | **Aktive** SkyHub-Next-Staging-Konfiguration |
| `stacks/legacy-skyhub/` | **Archivierter Snapshot – nicht starten** |
| `stacks/caddy/` | Übernommene Caddy-Konfiguration als Referenz |

## Dokumentation

- [Dokumentationswegweiser](docs/index.md)
- [Konfigurationsreferenz: Env, Compose, Flags und Startgrenzen](docs/config-reference.md)
- [API-Referenz: HTTP, Socket.IO, MQTT und Zugriffsmatrix](docs/api-reference.md)
- [Projektstand 23.10.2026: Main, PR-Ketten, Test-/Hardware-Evidenz](docs/projektstand-2026-10-23.md)
- [Priorisierter Integrationsplan: PR-Basisgraph, Reihenfolge und Prüfbedingungen](docs/integration-priorities-2026-10-23.md)
- [Gemeinsame Offline-Hardwarediagnostik: RC Pro/M3M, RC Plus 2/M4T](docs/hardware-diagnostics-consolidation.md)
- [M3M-Kamerafeldlücken ohne Thermografie-Fehlschluss](docs/m3m-camera-gap-analysis.md)\n- [M3M-Medieninventur Phase 1: rein lokale Dateinamen- und Bandzähler](docs/m3m-offline-media-inventory.md)
- [RC Plus 2/Matrice 4T: read-only Hardware-Prüfverfahren](docs/hardware-rc-plus2-m4t.md)
- [Architektur, Komponenten, Telemetrie-Integrität und API](docs/architecture.md)
- [Betrieb, Tests, Pi-Preflight und historische Diagnosebefunde](docs/ops.md)
- [Sicherheitsmodell, Authentifizierung, TLS und LAN-Zugriff](docs/security.md)
- [Trennung vom Legacy-Stack und Migrationsübersicht](docs/legacy-migration.md)
- [Legacy-Abhängigkeitsaudit und Bereinigungsentscheidung](docs/legacy-dependency-audit.md)
- [Betriebswerkzeuge: Nur lesen, Dateien schreiben oder Live-System ändern](docs/scripts.md)
- [Detaillierter Cutover- und Rollback-Plan](docs/skyhub-legacy-takeover.md)
- [DJI MQTT-/OSD-Integration](docs/mqtt-osd-integration.md)
- [DJI Cloud-API-Kompatibilität](docs/dji-cloud-api-compatibility.md)
- [Offline Cloud-API-1.18-Protokoll-Paritätsaudit (16 synthetische Fälle)](docs/dji-protocol-parity-audit.md)
- [Archivhinweise](stacks/README.md)

## Positionsaufzeichnung (standardmäßig deaktiviert)

Die Live-Telemetrie, Kartendarstellung und MQTT-OSD-Verarbeitung laufen
unabhängig von der PostGIS-Flugspuraufzeichnung. Mit
`SKYHUB_TRACK_RECORDING_ENABLED=false` (Standard) werden keine neuen
`drone_telemetry`-Punkte gespeichert; auch die automatische Löschung
alter Spurpunkte ist pausiert. Bestehende Spuren bleiben in der Datenbank
und sind weiterhin über die lesende Track-API abrufbar. Der Health-Endpunkt
meldet dann `trackRecordingEnabled:false`. Erst explizites `true`
und ein gezieltes Backend-Update aktivieren die Aufnahme wieder.
Die lokale `.env` bleibt unverändert.

## Erweiterte Live-Telemetrie

Das Dashboard zeigt neben den bisherigen Basiswerten zusätzliche bereits
durch den DJI-Parser unterstützte OSD-Felder an: Kurs, Vertikalgeschwindigkeit,
Nick-/Rollwinkel und Positionsqualitätscode. Außerdem wertet der Parser
optionale DJI-OSD-Felder für Wind (Geschwindigkeit und achtteiliger Richtungssektor),
kumulierte Flugzeit/-strecke sowie SDR-/4G-Verbindungszustände und 4G-Qualität
aus. Fehlende oder durch DJI mit ungültigen Sentinelwerten gemeldete
Messwerte werden nicht erraten. Nicht gemeldete optionale Felder
werden nicht als Messwerte ausgegeben; ein RTK-Fix-Code wird nicht mit dem
RTK-Ein/Aus-Schalter gleichgesetzt. Der Geräte-Snapshot enthält zuletzt
beobachtete Einzelwerte, deren Aktualität nun feldweise ausgewiesen wird.
Die DJI-MQTT-Verbindung, die Positionsaufzeichnung und die Pilot-Kopplung
bleiben unverändert.

### Feldgenaue Aktualität ohne Speicherung

SkyHub hält zu jedem empfangenen DJI-OSD-Feld `telemetryFieldAt` und
`telemetryFieldTimeVerified` in der flüchtigen Live-Registry im RAM.
Sie können über den geschützten HTTP-/WebSocket-Kanal abgerufen werden, werden
aber vor dem Schreiben in den Redis-Gerätecache explizit ausgeschlossen. Diese Metadaten
erscheinen in der bestehenden authentifizierten Geräte-API und ermöglichen
dem Dashboard, Einzelwerte als aktuell (weniger als 15 Sekunden),
veraltet, nicht empfangen oder „Zeit ungeprüft“ zu markieren. `(0,0)`
und unvollständige Koordinaten aktualisieren die Zeiten früherer gültiger
GPS-Fixes nicht. Ein anderes, frisch empfangenes OSD-Feld macht einen
alten Messwert nicht frisch. Die automatische Aktualisierung der Feld-
statuslabels baut die Gerätekarten nicht neu auf. Es werden keine
neuen PostGIS-Daten geschrieben und
`SKYHUB_TRACK_RECORDING_ENABLED=false` bleibt unverändert.

## Read-only-Feldinventar für Pilot 2

Auf dem Pi lässt sich mit `node scripts/pi-telemetry-fields-check.js` die
Verfügbarkeit von DJI-OSD-Feldern **getrennt nach Geräteklasse** prüfen.
Die fünf typischen RC-Felder werden separat von Fluggeräte-Telemetrie
ausgewertet. Weitere optionale Felder und gerätespezifisch nicht anwendbare
Felder werden getrennt aufgeführt. „Nicht beobachtet“ bedeutet weder
„nicht unterstützt“ noch „Parser defekt“.
 Die Ausführung nutzt nur
`docker compose exec` und den vorhandenen Backend-Zugriff auf die Geräte-API.
Ausgegeben werden ausschließlich Feldnamen und boolesche GPS-/OSD-Zustände,
**keine** Seriennummern, GPS-Koordinaten, Messwerte oder Zugangsdaten.
Keine Datei wird geschrieben. Der Report zeigt Felder, die im aktuellen
Geräte-Snapshot schon einmal beobachtet wurden; er ist kein Nachweis
für Werte im letzten einzelnen OSD-Paket.

## Sicher prüfen – ohne Deployment

```bash
node --check backend/server.js
node --test backend/test/*.test.js
python3 -m unittest discover -s tests -p 'test_*.py'
docker compose --env-file .env.example config --quiet
```

Diese Befehle starten keine SkyHub-Container. Die Compose-Konfigurationsprüfung führt keine Laufzeitvalidierung von MQTT, DJI-Hardware oder Caddy durch. Der Pi-spezifische, rein lesende Vorabcheck ist `bash scripts/pi-preflight.sh`; Details und Grenzen stehen in [Betrieb](docs/ops.md).

## Isolierte Staging-Umgebung

Das Root-Compose verwendet den Projektnamen `skyhub-next`, standardmäßig **127.0.0.1:4001** für das Backend und den vorhandenen Pi-EMQX auf **Hostport 1884**. Ein separates EMQX wird **nicht** gestartet; Port **4000** gehört bis zu einem ausdrücklich freigegebenen Cutover dem bisherigen Dienst. `.env` bleibt lokal und darf nicht versioniert werden. `.env.example` enthält nur Platzhalter und ist keine startfertige Konfiguration.

**Nicht** `docker compose up` im Archiv `stacks/legacy-skyhub/` ausführen und keine Docker-Container oder Datenvolumes im Rahmen eines Repo-Cleanups ersetzen. Produktivmigration und DJI-Hardwareabnahme sind getrennte Arbeitsschritte: [Legacy-Migration](docs/legacy-migration.md).

## Fortgesetzte Roadmap: DJI-Karte und PostGIS (P1/P2)

Der konsolidierte Root-Stack enthält die isoliert getesteten PostGIS- und Backup-/Restore-Prüfungen sowie eine standardmäßig deaktivierte DJI-Kartengruppen-GET-Route. Die serverseitige Pilot-Workspace-Bindung erlaubt ausschließlich lesenden Zugriff auf verteilte Gruppen. Die Mutationsengine samt revisionsbasierten Transaktionen und Audit ist **nur ein interner Entwurf**, nicht vom Backend geladen. Weder DJI-Karten-Schreib-APIs noch Missionen sind freigeschaltet.

- [DJI-Cloud-API-Referenz und Meilensteine](docs/dji-reference-roadmap.md)
- [DJI-Map-Elementvertrag](docs/dji-map-element-contract.md)
- [Workspace-Berechtigungen und Pilot-RBAC](docs/dji-map-access.md)
- [Interner Mutationsvertrag und Audit (kein Live-Schreibpfad)](docs/dji-map-mutation-contract.md)
- [Isolierte PostGIS- und Dump-/Restore-Tests](docs/postgis-isolated-validation.md)
- [Entwicklungsplan und Fortschritt](docs/entwicklungsplan-2026-10-20.md)

**Pi-Update:** Ein Git-Merge ist kein Deployment. Vor einem Update auf dem Pi lokale `.env`, Overrides und persistente PostGIS-Daten sichern, nur das bestehende Backend aktualisieren und danach über `/api/health` prüfen. Keine Compose-Volumes löschen, keine Legacy-Dienste starten und keine offenen DJI-Feature-Flags ungeprüft aktivieren.
