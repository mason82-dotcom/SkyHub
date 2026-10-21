# SkyHub Next

**Version 0.1.0 – Entwicklungsstand.** Die Branch-Suffixe v1/v2/v3/v4 sind keine Produktversionen.

SkyHub Next ist die **aktive Entwicklungsbasis im Repository-Root**. Sie verarbeitet DJI-Cloud-API-Telemetrie mit Node.js/Express, Socket.IO, MQTT, Redis und PostGIS und stellt ein kompaktes statisches Live-Dashboard bereit. Eine Medien-API, ein produktionsreifer Missionseditor und echte Analyse-Worker gehören noch nicht zum Funktionsumfang. Der Root-Code ist **nicht automatisch identisch** mit dem aktuell auf dem Raspberry Pi betriebenen alten Dienst.

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

- [Architektur, Komponenten, Telemetrie-Integrität und API](docs/architecture.md)
- [Betrieb, Tests, Pi-Preflight und historische Diagnosebefunde](docs/ops.md)
- [Sicherheitsmodell, Authentifizierung, TLS und LAN-Zugriff](docs/security.md)
- [Trennung vom Legacy-Stack und Migrationsübersicht](docs/legacy-migration.md)
- [Legacy-Abhängigkeitsaudit und Bereinigungsentscheidung](docs/legacy-dependency-audit.md)
- [Betriebswerkzeuge: Nur lesen, Dateien schreiben oder Live-System ändern](docs/scripts.md)
- [Detaillierter Cutover- und Rollback-Plan](docs/skyhub-legacy-takeover.md)
- [DJI MQTT-/OSD-Integration](docs/mqtt-osd-integration.md)
- [DJI Cloud-API-Kompatibilität](docs/dji-cloud-api-compatibility.md)
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
beobachtete Einzelwerte, deren Zeitstempel nicht individuell vorliegen.
Die DJI-MQTT-Verbindung, die Positionsaufzeichnung und die Pilot-Kopplung
bleiben unverändert.

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
