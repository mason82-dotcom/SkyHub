# SkyHub – kontrollierte Übernahme des bisherigen Dienstes (Port 4000)

Status: **Vorbereitung, noch kein Cutover auf dem Raspberry Pi ausgeführt.**

## Ziel

- Der bestehende SkyHub-HTTP-Endpunkt `192.168.178.63:4000` soll
  zukünftig vom **MQTT-integrity-v3**-Backend beantwortet werden.
- `GET /pilot-login` und `GET /api/pilot/status` werden bereitgestellt.
- DJI Pilot 2 spricht später weiter mit **EMQX auf Pi-Port 1884**.
- Die bestehenden Container `skyhub_emqx`, `skyhub_redis`,
  `skyhub_postgres` und Caddy werden **nicht** automatisch gestoppt,
  neu erstellt oder ersetzt.
- Der alte Backend-Container `skyhub_backend` wird bei einem
  freigegebenen Cutover ausschließlich **gestoppt, nicht gelöscht**.
  Seine ursprüngliche Restart-Policy muss für den Rückweg erfasst werden.
- Das neue System nutzt isolierte Datenvolumes und ein eigenes
  Compose-Projekt `skyhub-next`. Dies ist **noch keine Migration**
  alter PostgreSQL-, Redis- oder Medienbestände.

## Risiken/Unterschiede vor der Freigabe

- Die alte Backend-API implementiert `POST /api/mission/create` mit
  MQTT-Publish; SkyHub Next antwortet bewusst mit HTTP **501**
  (Missionssteuerung deaktiviert). Ein Ersatz ist **nicht**
  feature-identisch.
- Das neue Dashboard verlangt `SKYHUB_VIEW_TOKEN`, wo die alte Version
  teilweise ohne Authentifizierung lief. Bestehende Client-Integrationen
  können deshalb neu konfiguriert werden müssen.
- Die neue PostGIS-/Redis-Datenhaltung besitzt eigene Volumes. Historische
  Aufzeichnungen und Medien sind **nicht automatisch vorhanden**.
- Der neue Cloud-H5-Endpunkt ist **standardmäßig deaktiviert**. Auf
  `0.0.0.0:4000` darf für die Pilot-Lizenz-/MQTT-Credential-Bootstrap-
  Strecke **kein** Klartextbetrieb freigegeben werden. Bei einer
  Übernahme der alten LAN-HTTP-URL wird `SKYHUB_PILOT_ENABLED=false`
  belassen. Ein späterer aktiver H5-Login benötigt einen separaten
  Caddy-HTTPS-Zugang zu einem ausschließlich loopback-gebundenen Backend.
- Das derzeitige Caddy-Zertifikat von `rpi5.fritz.box` wurde nur nach
  explizitem Vertrauen auf die **Caddy-Root-CA** verifiziert.
  Die RC-WebView ist noch nicht als vertrauenswürdig nachgewiesen.
- Ein Caddy-`HTTP 302` auf `/` und `404` auf `/pilot-login` betrifft
  vorhandene Caddy-Routen. Hier werden **keine** Caddy-Änderungen
  vorgenommen. Ein neuer Backend-Port 4000 behebt diese HTTPS-404
  nicht automatisch.

## A. Read-only Audit (jetzt ausführen)

```bash
cd ~/Projekte/SkyHub-Next
git pull --ff-only
bash scripts/pi-skyhub-takeover-audit.sh
```

Das Skript gibt keine Werte aus der `.env` oder aus Docker-Umgebungen
aus. Es ermittelt Containerzustand, Restart-Policies, Mount-Typen,
freigegebene Ports und HTTP-Antworten. Vor weiteren Schritten die
vollständige Diagnose auswerten, insbesondere DB- und Redis-Abhängigkeiten.

## Auditergebnis 20.10.2026: 49 Tests erfolgreich, Secrets noch unvollständig

Der Pi hat **49/49 Node-Tests bestanden**. Der alte
`skyhub_backend` läuft mit Restart-Policy `always`, ebenso
`skyhub_emqx`, `skyhub_postgres` und `skyhub_redis`.
Host-Port `4000` bleibt belegt, `4001` frei.
Der alte HTTP-Server liefert für `/`, `/pilot-login`
und `/api/health` jeweils 404. SkyHub Next hat noch keine
laufenden Container. Docker Compose kann seine Konfiguration
syntaktisch auswerten.

Die lokale, private `.env` hat Modus 600. Die drei DJI-Lizenzfelder
sind gesetzt, aber `SKYHUB_VIEW_TOKEN`, `SKYHUB_DB_PASSWORD`,
`MQTT_USER` und `MQTT_PASSWORD` sind noch Platzhalter.
`SKYHUB_PILOT_ENABLED=false` bleibt korrekt.

### Neue lokale Staging-Secrets sicher erzeugen

```bash
cd ~/Projekte/SkyHub-Next
git pull --ff-only
python3 scripts/pi-prepare-staging-env.py
python3 scripts/pi-prepare-staging-env.py --apply
```

Der erste Befehl des Scripts ist nur ein Dry-Run. `--apply` erstellt
ein privates Backup der bestehenden `.env` unter
`~/Projekte/_backups/skyhub-env-*/skyhub-next.env` und ersetzt **nur**
fehlende oder mit `REPLACE_` beginnende Werte von
`SKYHUB_VIEW_TOKEN` und `SKYHUB_DB_PASSWORD` durch jeweils
kryptographisch zufällige 64-stellige Hex-Strings. Bereits
konfigurierte DJI-Lizenzwerte, andere Zugangsdaten, Netzwerkadressen
und der `SKYHUB_PILOT_ENABLED`-Status bleiben vollständig unangetastet.
Das Script druckt keine Geheimnisse und startet keinen Dienst.

`MQTT_USER` und `MQTT_PASSWORD` müssen **gültige Zugangsdaten des
bestehenden EMQX auf Host-Port 1884** enthalten. Ein zufällig erzeugtes
Passwort funktioniert nicht, solange das passende Brokerkonto noch
nicht provisioniert wurde. Empfohlen wird ein separates Subscribe-only-
EMQX-Konto für das neue Backend und separat später ein Pilot-2-Account.
Nie die Credentials im Chat oder in GitHub veröffentlichen.

### Vor dem Backup die Daten- und Speichergrößen lesen

```bash
df -h ~/Projekte ~/Projekte/_backups
findmnt -T ~/Projekte/_backups -o SOURCE,TARGET,FSTYPE
docker exec skyhub_postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -XAtqc "SELECT pg_database_size(current_database())"'
docker exec skyhub_redis redis-cli INFO persistence \
  | grep -E '^(aof_enabled|rdb_last_bgsave_status|rdb_last_save_time):'
```

Diese Abfragen sind lesend und zeigen keine Passwörter.
Für die spätere Datenbanksicherung ein separates
`pg_dump -Fc` verwenden und über `pg_restore -l` auf Lesbarkeit
prüfen. Redis und etwaige Medienobjekte müssen separat bewertet
werden. Der Backup-Speicherort sollte nicht auf einem instabilen
NVMe-Dateisystem liegen.

## B. Datenbestand vollständig sichern (erst nach Auditergebnis)

1. Eine lokale, nur für `mason` lesbare Backup-Ablage auf einem
   **zuverlässig gemounteten** Medium anlegen. Vorher freien Platz,
   Dateisystem und den bekannten NVMe-Stabilitätszustand kontrollieren.
2. Den alten Backend-Containerzustand einschließlich
   Restart-Policy, Image-Referenz und Compose-Labels sichern.
   `docker inspect` kann Secrets enthalten: Dateien nur mit Modus 600
   anlegen, nie den vollständigen Inhalt hier posten.
3. **Konsistentes PostgreSQL-`pg_dump`** des existierenden
   `skyhub_postgres` erstellen und die Archivdatei auf Fehler prüfen.
4. Redis und eventuelle vorhandene Medien-Volumes **gesondert**
   auf Datenbestand und Sicherungsverfahren prüfen. Keine
   `docker compose down -v`-Kommandos verwenden.
5. Den Caddyfile-Snapshot gesondert sichern, bevor später eine Route
   ergänzt wird.

## C. Staging auf Port 4001 (nach erfolgreichem Audit und Backup)

- Vor dem ersten Start `.env` ohne Ausgabe von Geheimnissen überprüfen,
  `SKYHUB_PILOT_ENABLED=false` belassen und
  `SKYHUB_BIND_ADDRESS=127.0.0.1`,
  `SKYHUB_HTTP_PORT=4001` verwenden.
- Erst danach ausdrücklich autorisiert den separaten
  `skyhub-next`-Stack starten, Build, MQTT-Subscription und
  Telemetrie-Health prüfen. Das bedeutet zusätzliche DB- und
  Redis-Container und ist daher vorab auf Pi-Ressourcen zu prüfen.
- Die folgenden Staging-Prüfungen müssen HTTP 200 liefern:

```bash
curl -fsS http://127.0.0.1:4001/api/health
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:4001/pilot-login
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:4001/api/pilot/status
```

Dabei bedeuten `mqtt:true`/`subscribed:true` nur erfolgreiche
Broker-Anmeldung und Abonnements. Es muss vor dem Cutover gesondert
geprüft werden, ob `mqttValidTelemetryUpdates` tatsächlich steigt.

## D. Wartungsfenster: Legacy-HTTP-Port 4000 übernehmen

**Noch nicht ausführen.** Erst nach A–C und dokumentierter
Rollback-Freigabe. Die Schritte betreffen nur das alte HTTP-Backend,
nicht EMQX, Mosquitto, Postgres, Redis oder Caddy:

1. Ursprüngliche Restart-Policy von `skyhub_backend` und das
   gesicherte Docker-Inspect-Artefakt bereithalten.
2. Den alten Container per `docker update --restart=no skyhub_backend`
   gegen automatischen Neustart absichern und mit
   `docker stop skyhub_backend` stoppen; **nicht löschen**.
3. Den getesteten neuen Backend-Container mit
   `SKYHUB_BIND_ADDRESS=0.0.0.0` und `SKYHUB_HTTP_PORT=4000`
   kontrolliert neu erstellen. **Pilot-Onboarding bleibt deaktiviert**,
   bis HTTPS und CA-Vertrauen geklärt sind.
4. Health-API, `GET /pilot-login`, DJI-MQTT-Port 1884 und die
   bestehenden Caddy-Dienste kontrollieren.
5. Nur nach erfolgreichen Checks die HTTP-Bindung in der lokalen
   `.env` dauerhaft anpassen, damit ein späteres
   `docker compose up` nicht unabsichtlich zurück auf 4001 schaltet.

## E. Rollback bei Störung

1. Neuen Backend-Container von Port 4000 zurück auf den
   getesteten Staging-Port 4001 umstellen oder kontrolliert stoppen.
2. `skyhub_backend` erneut starten und die **zuvor gesicherte**
   Restart-Policy wiederherstellen.
3. Altes HTTP `4000`, EMQX `1884`, Caddy `443` sowie
   DB- und Redis-Integrität erneut prüfen.
4. Originale Datencontainer, Volumes und Images nicht löschen.

**Kein automatischer Cutover durch dieses Dokument oder Audit.**
