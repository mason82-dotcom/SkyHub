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
- [Betriebswerkzeuge: Nur lesen, Dateien schreiben oder Live-System ändern](docs/scripts.md)
- [Detaillierter Cutover- und Rollback-Plan](docs/skyhub-legacy-takeover.md)
- [DJI MQTT-/OSD-Integration](docs/mqtt-osd-integration.md)
- [DJI Cloud-API-Kompatibilität](docs/dji-cloud-api-compatibility.md)
- [Archivhinweise](stacks/README.md)

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
