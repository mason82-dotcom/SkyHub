# Legacy-Abhängigkeitsprüfung – SkyHub Next

**Stand der statischen Prüfung:** 20.10.2026, Cleanup-Branch `chore/reposafe-cleanup-20261020`. Die Aussagen beziehen sich auf die versionierten Dateien dieses Branches, **nicht** auf die derzeit laufenden Pi-Container. Die lokale Live-Konfiguration kann abweichen.

## Inventur und Referenzen

Vor Phase 3 umfasst `stacks/legacy-skyhub/` **30 versionierte Dateien (70.074 Byte)**. Enthalten sind der historische Compose-Stack, Node-Backend, statisches Frontend, M3E-/M3M-/Thermal-Worker, PostGIS-Schema, EMQX-Konfiguration, Migrationsskript und Design-/UX-Dokumentation. Dazu kommen `stacks/caddy/Caddyfile` sowie `stacks/README.md` als historische Referenzen.

**Verifizierte aktive Querverbindungen:**

| Quellpfad | Abhängigkeit zum Archiv | Bewertung |
|---|---|---|
| `backend/*.js` | Keine direkte Referenz auf `stacks/legacy-skyhub/` gefunden | Laufzeit basiert auf Root-Backend |
| `backend/Dockerfile` | `frontend/public/` wird kopiert; keine Legacy- oder React-Quellen | Statische Oberfläche ist die aktive UI |
| `scripts/pi-emqx-harden.js` | Liest `stacks/legacy-skyhub/running-emqx/acl.conf` in `originalRules()` | **Echte Betriebsabhängigkeit** für `rollback`; nicht entfernen |
| `.github/workflows/ci.yml` | Syntaxprüfung (`sh -n`) für `stacks/legacy-skyhub/scripts/migrate-env.sh` | Keine Ausführung; historischer Test-/Archivbezug |
| `stacks/caddy/Caddyfile` | Keine aktiv eingebundene Root-Docker-/Skript-Referenz | Historischer Caddy-Snapshot; keine produktive Quelle |

**Kritisch:** Der `running-emqx/acl.conf`-Snapshot enthält `{allow, all}.`. Der bestehende `pi-emqx-harden.js rollback`-Modus setzt zudem den Authenticator zurück. Ein Rollback dieses Skripts stellt also **nicht** zwangsläufig einen sicheren Zustand wieder her, sondern ausdrücklich den früheren anonymen Zugang. `rollback` niemals für bloßes Repository-Aufräumen verwenden. Vor einer späteren Entkopplung ist ein sicherer, mit realer Hardware getesteter ACL-Restore-Pfad erforderlich.

## Entbehrliche Datei

`frontend/src/App.jsx` war ein isolierter React-v2-Platzhalter: Kein Root-`package.json`-Build, keine Referenz im Backend oder aktiven Dockerfile, keine Einbindung in `frontend/public`. Er enthielt nur einen unverbundenen Telemetrie-Dummy und irreführende Verbindungshinweise. Deshalb aus dem **aktiven** Branch entfernt. Der Inhalt bleibt über Git-Historie rekonstruierbar.

## Entscheidung über den Altbestand

| Kategorie | Entscheidung | Grund |
|---|---|---|
| `stacks/legacy-skyhub/running-emqx/acl.conf` | **Behalten** | Direkte Abhängigkeit des bestehenden EMQX-Hardening-/Rollback-Skripts |
| Historisches Legacy-Compose und `emqx/` | **Behalten, nicht starten** | Referenz für Cutover, ACL-Unterschiede und Wiederherstellung |
| Legacy-Backend, Frontend, Schema und Worker | **Behalten als Referenz** | Altstände sind semantisch nicht zwingend identisch; keine überprüfte vollständige Funktionsmigration |
| `stacks/caddy/Caddyfile` | **Behalten als Snapshot** | Produktive Nextcloud-/DJI-Routen müssen vor Änderungen am echten Caddy erneut ermittelt werden |
| `frontend/src/App.jsx` | **Entfernen** | Ungenutzter, nicht eingebundener UI-Platzhalter |
| Komplettes Verschieben/Löschen von `stacks/legacy-skyhub/` | **Zurückstellen** | Würde den dokumentierten und getesteten EMQX-Rollback-Dateipfad unterbrechen |

## Automatische Sicherheitsgrenze

`tests/test_repository_boundaries.py` hält zwei explizite Verweise aus aktiven Dateien ins Archiv als erlaubte Ausnahmen fest. Jeder neue Verweis muss bewusst geprüft und freigegeben werden; CI schlägt andernfalls fehl. Weitere Prüfungen erkennen ein wieder eingeführtes React-Dummy, einen versehentlich gestarteten Legacy-Broker im Root-Compose und aktivierende Betriebsbefehle in der CI.

Diese Tests sind **statische Architekturwächter**, keine Laufzeit-/Hardwaretests, keine DJI-Cloud-API-Konformitätsprüfung und kein Nachweis eines funktionsfähigen Restores.

**Weiterführend:** [Archiv und Migration](legacy-migration.md), [Betriebsskripte](scripts.md), [Cutover-Plan](skyhub-legacy-takeover.md).
