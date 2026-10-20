# Legacy-Trennung und Migrationspfad

Die geprüften Abhängigkeiten und die Entscheidung, welche Archivdateien vorerst erhalten bleiben, sind im [Legacy-Abhängigkeitsaudit](legacy-dependency-audit.md) dokumentiert.

## Gültige Zuständigkeiten

| Ort | Rolle | Betrieb |
|---|---|---|
| Repository-Root `backend/`, `frontend/`, `docker-compose.yml` | Aktive SkyHub-Next-Entwicklung | Eigenes Compose-Projekt `skyhub-next`; standardmäßig Loopback-Port 4001 |
| `stacks/legacy-skyhub/` | Historischer Snapshot der alten Installation | **Archiv – niemals von hier starten oder mit `-p skyhub` deployen** |
| `stacks/caddy/Caddyfile` und `stacks/legacy-skyhub/running-emqx/` | Historisch übernommene Betriebs-Konfigurationen | Nur Referenz, nicht automatisch einspielen |
| Laufender Raspberry Pi | Reale Produktivumgebung | Zustand nur vor Ort durch Audit bestimmen, nicht aus Git-Dateien ableiten |

**Keine automatische Migration:** Die beiden Compose-Projekte besitzen verschiedene Datenvolumes und API-/Sicherheitsmodelle. Die historische Konfiguration wird im Cleanup nicht gelöscht, verschoben oder gestartet. Der bestehende HTTP-Dienst, EMQX, Redis, Postgres, Caddy sowie Docker-Volumes bleiben unangetastet.

Die verbindliche Schritt-für-Schritt-Checkliste für Sicherung, Staging, Portübernahme und Rollback befindet sich in [SkyHub Legacy Takeover](skyhub-legacy-takeover.md). Für den alten Quellstand siehe [Archivübersicht](../stacks/README.md).

## Übernahme des bisherigen SkyHub-Dienstes auf Port 4000

Die Übernahme des bestehenden `skyhub_backend` wird als **kontrollierter,
rückrollbarer Cutover** vorbereitet. Die heutige `mqtt-integrity-v3`-
Version enthält jetzt die H5-Seite `/pilot-login`, Pilot-Konfiguration
und TLS-geschützte Bootstrap-API aus dem früheren Entwicklungsbranch.
Sie behält ihre strengeren MQTT-Zeitstempel-, Replay-/Retain- und
Positionsintegritätsprüfungen. Die H5-Aktivierung bleibt **aus**.

Port 4000 gehört weiterhin dem alten Backend; Port 4001 ist zunächst
für einen isolierten Staging-Test vorgesehen. Eine neue bindende
Konfiguration auf dem Host **wurde noch nicht ausgeführt**.
Der alte Backend-Container bleibt bei einer späteren Umschaltung
für den Rollback vorhanden, und die bisherigen DB-, Redis-, EMQX-
und Medien-Container werden nicht ersetzt. Der neue SkyHub-Next-Stack
nutzt allerdings **andere** Datenvolumes und seine API deaktiviert
Missionsveröffentlichungen. Eine Datenmigration ist damit noch nicht erledigt.

**Vor jedem Cutover ausschließlich lesend prüfen:**

    bash scripts/pi-skyhub-takeover-audit.sh

Der Schrittplan mit Datensicherung, Staging, Portübernahme, und Rollback
steht in [SkyHub Legacy Takeover](skyhub-legacy-takeover.md).
