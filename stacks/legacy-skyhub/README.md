# ARCHIV – Legacy SkyHub (nicht starten)

> **Nur als Quellcode- und Konfigurationsreferenz aufbewahrt.** Dieses Verzeichnis ist ein Snapshot des früheren SkyHub-Stacks und **kein** eigenständiges Deployment-Ziel. Die folgende historische Dokumentation enthält Start-, Konfigurations- und Migrationsbefehle, die **nicht** als aktuelle Betriebsanleitung gelten. Weder das Compose in diesem Ordner noch seine EMQX-/Postgres-/Redis-Konfiguration auf dem produktiven Pi starten oder einspielen.

**Aktive SkyHub-Next-Entwicklung:** [Repository-README](../../README.md). **Migrationsverfahren:** [Legacy-Migration](../../docs/legacy-migration.md) und [Cutover-Audit](../../docs/skyhub-legacy-takeover.md). Die produktiven Docker-Container können weiterhin den historischen Stand ausführen; sie werden durch das Hinzufügen dieses Archivhinweises nicht verändert.

---

## Historische Originaldokumentation (nur Referenz)

# SkyHub Enterprise Flight Console

Lokaler, standardmäßig read-only arbeitender DJI-Telemetriedienst für PostGIS, Redis, EMQX und ein integriertes Web-Dashboard.

## Sicherheitsmodell

- Flugaufträge sind standardmäßig deaktiviert (`MISSION_DISPATCH_ENABLED=false`).
- Pilot-Anmeldung akzeptiert keine beliebigen Zugangsdaten mehr.
- PostgreSQL und Redis werden nicht am Host veröffentlicht.
- MQTT und Dashboard binden standardmäßig nur an `127.0.0.1`. Für DJI Pilot 2 muss gezielt die LAN-IP gesetzt werden.
- EMQX verwendet zwei authentifizierte Benutzer und eine deny-by-default ACL.
- Das Dashboard ist read-only und zeigt „live“ erst nach einer validierten DJI-OSD-Nachricht.

## Erstkonfiguration

```bash
cp .env.example .env
```

Alle `replace-with-...`-Werte müssen durch unabhängige Zufallswerte ersetzt werden:

```bash
openssl rand -hex 32
```

Bei einer bestehenden Installation migriert das folgende Kommando die alte
Konfiguration, legt vorher ein geschütztes Backup an und erzeugt neue lokale
Zugangsdaten:

```bash
./scripts/migrate-env.sh
```

Anschließend muss `MQTT_GATEWAY_PASSWORD` aus `.env` auch im DJI-Pilot-Gateway
für den Benutzer `dji-gateway` hinterlegt werden.

Wichtige Werte:

- `SKYHUB_LAN_IP`: konkrete LAN-Adresse des SkyHub-Rechners, beispielsweise `192.168.178.63`.
- `MQTT_GATEWAY_PASSWORD`: Passwort für DJI Pilot 2; MQTT-Benutzer ist fest `dji-gateway`.
- `PILOT_USERNAME` und `PILOT_PASSWORD`: Zugang für `/api/v1/login`.
- `MISSION_DISPATCH_ENABLED`: bleibt ohne separate Flug-/Betriebsfreigabe `false`.

Vor dem Start prüfen:

```bash
docker compose config --quiet
npm --prefix backend test
npm --prefix frontend run build
```

Danach:

```bash
docker compose up -d --build
docker compose ps
curl -fsS "http://${SKYHUB_LAN_IP}:4000/api/v1/health"
```

## Zugriff

| Dienst | Adresse | Exposition |
|---|---|---|
| Dashboard/API | `http://<SKYHUB_LAN_IP>:4000` | konkrete LAN-IP |
| DJI MQTT | `<SKYHUB_LAN_IP>:1884` | konkrete LAN-IP, Auth erforderlich |
| EMQX Dashboard | `http://127.0.0.1:18084` | nur Loopback |
| PostgreSQL | intern `postgres:5432` | nicht veröffentlicht |
| Redis | intern `redis:6379` | nicht veröffentlicht, Passwort erforderlich |

## DJI-MQTT

SkyHub verarbeitet begrenzte Payloads auf:

- `thing/product/+/osd`
- `thing/product/+/state`
- `thing/product/+/events`
- `thing/product/+/services_reply`

OSD-Werte werden aus dem offiziellen `data`-Envelope gelesen. Fehlende Werte werden nicht als Null erfunden. Cache-Einträge verfallen nach fünf Minuten; das Dashboard markiert Daten bereits nach 15 Sekunden als veraltet.

## Missionsübertragung

Der Endpunkt bleibt fail-closed. Für eine bewusste Aktivierung sind gleichzeitig erforderlich:

1. `MISSION_DISPATCH_ENABLED=true`
2. ein mindestens 32 Zeichen langes `SKYHUB_ADMIN_TOKEN`
3. eine exakte Origin-Allowlist in `MISSION_FILE_ALLOWED_ORIGINS`
4. `Authorization: Bearer <token>`
5. eine MD5-Dateisignatur als `fileSign`

Die HTTP-Antwort `202 queued` bestätigt ausschließlich die Übergabe an MQTT, nicht die Annahme durch Aircraft oder RC. Der verwendete DJI-Dienst `flighttask_create` ist veraltet und muss vor realem Flugbetrieb durch den für die Hardware freigegebenen Wayline-Workflow ersetzt werden.

## Analyse-Worker

Die M3E-, M3M- und Thermal-Worker enthalten derzeit ausschließlich Simulationen. Ohne den expliziten Schalter `--simulation` brechen sie absichtlich ab. Simulationsergebnisse sind als `simulated` beziehungsweise `*_simulated_*` gekennzeichnet und dürfen nicht betrieblich verwendet werden.
