# Archiv und übernommene Betriebsreferenzen

> **ARCHIV – KEIN DEPLOYMENT-ZIEL.** Alle Dateien unter `stacks/legacy-skyhub/` und `stacks/caddy/` sind historische Snapshots. Das aktive SkyHub-Next-Compose liegt ausschließlich im Repository-Root. Insbesondere **niemals** `docker compose up` aus `stacks/legacy-skyhub/` oder `docker compose -p skyhub up` auf Basis dieses Snapshots ausführen. Dies könnte laufende Container ersetzen und DJI-Verbindungen unterbrechen.

Zur Architektur und den Unterschieden siehe [Legacy-Migration](../docs/legacy-migration.md). Ein Cutover darf erst nach [Audit, Sicherung und Rückfallplan](../docs/skyhub-legacy-takeover.md) erfolgen.

---

## Historische Snapshot-Notizen (Stand 20.10.2026)

- `legacy-skyhub/`: Kopie von `~/Projekte/SkyHub` (Stand 20.10.2026).
  `.env` und `.skyhub-env-backups/` liegen nur lokal (Rechte 600/700, per
  `.gitignore` ausgeschlossen).
- `legacy-skyhub/running-emqx/`: `emqx.conf` und `acl.conf` aus dem **laufenden**
  Container `skyhub_emqx`. Der Node-Cookie ist ausgeblendet; live kommt er aus
  `EMQX_NODE__COOKIE`.
- `caddy/Caddyfile`: aktive Caddy-Konfiguration aus `/opt/caddy`, inklusive
  der Route `/pilot-login*` und `/api/pilot/*` → `127.0.0.1:4001`.

Die Dateien dienen als Referenz für Cutover und EMQX-Absicherung, **nicht** zum Starten.

## Abweichung vom Live-Stand

Die laufenden Container `skyhub_emqx`, `skyhub_backend`, `skyhub_postgres` und
`skyhub_redis` (Compose-Projekt `skyhub`) wurden **vor** der letzten Änderung
der Dateien in `legacy-skyhub/` erstellt:

| | `legacy-skyhub/emqx/` (Datei) | `running-emqx/` (live) |
|---|---|---|
| Authentifizierung | `init-auth.sh` legt `skyhub-core` / `dji-gateway` an | keine, anonym erlaubt |
| ACL | gezielte Regeln, Abschluss `{deny, all}` | Abschluss `{allow, all}` |
| Config-Mounts | `emqx.conf`, `acl.conf` read-only | keine (Image-Standard) |

Die ACL-Datei ist eine Grundlage für die Absicherung, siehe
`docs/mqtt-osd-integration.md`. Für Pilot 2 fehlen ihr aber Rechte, die die RC Pro
tatsächlich abonniert: `thing/product/{sn}/property/set`, `events_reply`,
`requests_reply`, `state_reply` und `sys/product/{sn}/network/probe`.
Der SkyHub-Next-Subscriber und der Topologie-Publisher brauchen eigene Benutzer.

## Nicht von hier aus starten

`docker compose up` in `legacy-skyhub/` legt ein neues Compose-Projekt mit
denselben festen `container_name`-Werten an. Das scheitert an Namenskonflikten.
Mit `-p skyhub` würden die laufenden Container mit der abweichenden
Konfiguration **ersetzt**, und die RC würde getrennt. Der Live-Betrieb bleibt in
`~/Projekte/SkyHub`, bis der Cutover nach `docs/skyhub-legacy-takeover.md`
erfolgt.
