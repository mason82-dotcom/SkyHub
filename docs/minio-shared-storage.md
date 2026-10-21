# Gemeinsamer MinIO-Objektspeicher auf dem Raspberry Pi

Stand: 21.10.2026. **GitHub-Änderungen deployen nicht auf den Pi.**
Ziel ist **ein** MinIO-Server für SkyHub Next und ausgewählte S3-Clients anderer
Pi-Compose-Stacks. Der bisherige optionale Root-Compose-Dienst `minio` mit
`minio_data:/data` bleibt erhalten. Es findet **keine** automatische Migration,
kein Löschen und kein Ersatz eines vorhandenen MinIO-Datenvolumes statt.

## Topologie und Abgrenzung

```text
skyhub-next/default:   backend --- postgres, redis
                          |
skyhub-storage-net:       +-- skyhub-minio:9000 (S3 API)
                          |      |
                          |      +-- skyhub-next_minio_data:/data
                          |
                          +-- ausdrücklich angebundene Pi-Worker/Container
```

Die ergänzende Datei `docker-compose.storage.yml` gibt **nur** dem optionalen
MinIO-Dienst und dem Backend ein gemeinsames externes Bridge-Netz
`skyhub-storage-net`. Postgres, Redis, EMQX und der alte SkyHub-Stack
bleiben davon ausgenommen. Docker-interner Endpunkt:
`http://skyhub-minio:9000`. Kein Host-Port (auch keine Admin-Konsole auf
9001) wird geöffnet. DNS-Alias `skyhub-minio` ist im gemeinsamen Netz stabil.
Der Endpunkt ist **nicht** per Internet erreichbar, solange keine weiteren
Proxies/Ports eingerichtet werden.

SkyHub Next nutzt noch **keine** S3-Medien-API. Die Umgebungsvariablen
`SKYHUB_S3_ENDPOINT` und `SKYHUB_S3_REGION` sind eine vorbereitete
Schnittstelle, kein bereits implementierter Upload. Auch DJI-Pilot-2-Uploads,
WPML-Importe, M3M-Rohbildarchivierung und Bucket-Provisionierung sind
ausdrücklich **nicht aktiviert**.

## 1. Lesende Bestandsaufnahme

Nach geprüftem Fast-forward des Projektzweigs auf dem Pi:

```bash
cd ~/Projekte/SkyHub-Next
bash scripts/pi-minio-network.sh plan
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker volume ls --format 'table {{.Name}}'
```

Bei bereits vorhandenem, **anderem** MinIO aus AeroNexus oder sonstigen
Stacks **nicht** `apply` ausführen. Dessen Datenträger, Buckets,
Identität und Zugriff zuerst getrennt ermitteln. Falls die Instanz läuft,
kann sie anschließend mit `adopt` als **einziger** gemeinsamer S3-Server
weiterverwendet werden, statt einen neuen leeren Speicher aufzubauen.
Das vorhandene Datenvolume bleibt am ursprünglichen MinIO-Container.
Secrets und Objektlisten nicht in Chat oder GitHub kopieren.

## 2. Image und Secrets absichern

Historischer Stand im Root-Compose:
`minio/minio:RELEASE.2023-09-04T19-57-37Z`. Dieses Image ist alt.
Das ursprüngliche MinIO-Community-Projekt ist inzwischen archiviert;
aktuelle Community-Ausgaben sind **Source-only**. Für reale Daten ist
ein **geprüftes und für Linux/ARM64 geeignetes Image mit gepflegter
Sicherheitsversorgung** nötig. Bildherkunft, Signaturen, Lizenz,
Upgrade-/Rollback-Verfahren und Image-Digest vor Aktivierung überprüfen.
Die Image-Auswahl ist absichtlich **nicht** automatisch.

Eine freigegebene Image-Referenz ausschließlich lokal in `.env` setzen:

```dotenv
SKYHUB_MINIO_IMAGE=registry.example.invalid/approved-minio:PINNED_TAG
```

Das Beispiel ist **kein** abrufbares Image. Der alte Default wird bei
`apply` gesperrt, außer für bewusst isolierte Tests mit
`--allow-legacy-image`. Niemals diese Testfreigabe für produktive
DJI-Daten verwenden. Die bestehenden `SKYHUB_MINIO_USER` und
`SKYHUB_MINIO_PASSWORD` bleiben in der privaten `.env` und dürfen
nur den MinIO-Root-Account konfigurieren. Andere Pi-Container dürfen
**keine Root-Zugangsdaten** erhalten.

## 3. Opt-in-Anbindung des bestehenden SkyHub-Backends

Erst nach Prüfung des Speicherorts (NVMe/SD), Backup-Konzepts und der
Bildreferenz:

```bash
cd ~/Projekte/SkyHub-Next
bash scripts/pi-minio-network.sh apply
bash scripts/pi-minio-network.sh verify
```

`apply` prüft die Compose-Konfiguration und erstellt bei Bedarf das
externe Docker-Bridge-Netzwerk. Ein bereits laufender SkyHub-MinIO-Container
mit **erwartetem Image und vorhandenem Originalvolume** wird nur per
`docker network connect --alias skyhub-minio` angebunden, **ohne ihn neu
zu erstellen**. Bei abweichendem Image oder Mount wird abgebrochen.
Nur für einen fehlenden oder gestoppten SkyHub-MinIO verwendet das Skript
`docker compose ... up -d --no-deps minio`. Ein laufender
SkyHub-Next-Backend-Container wird anschließend per `docker network connect`
angebunden: **kein Backend-Restart** und keine Änderungen an PostgreSQL,
Redis, EMQX oder Caddy. Ein vorhandenes `skyhub-next_minio_data`
bleibt unverändert. Beim **ersten** MinIO-Start erzeugt Docker das
Volume, sofern noch nicht vorhanden. `verify` liest den MinIO-Readiness-
Endpunkt aus dem bestehenden Backend-Container, erstellt aber keine
Objekte oder Buckets.

## 4. Vorhandenen MinIO aus AeroNexus oder anderem Compose übernehmen

Nach der lesenden Bestandsaufnahme und Sichtprüfung aller Container:

```bash
# NUR den konkret geprüften, laufenden MinIO-Container einsetzen:
bash scripts/pi-minio-network.sh adopt NAME_DES_BESTEHENDEN_MINIO
bash scripts/pi-minio-network.sh verify
```

Dieser Modus startet **keinen** MinIO-Container, legt keine Buckets an,
wechselt kein Image und ändert weder das MinIO-Datenvolume noch dessen
Credentials. Er prüft vor der Anbindung, dass MinIO läuft, eine
Speicher-Einbindung besitzt, über eine Bridge angebunden werden kann
und keine zweite MinIO-Instanz/kein doppelter DNS-Alias existiert.
Anschließend erhalten der bestehende MinIO und das SkyHub-Backend
`skyhub-storage-net` als zusätzliche Verbindung. Ein Neustart ist nicht
vorgesehen. Eine bereits vorhandene Verknüpfung ohne den Alias
`skyhub-minio` führt aus Sicherheitsgründen zum Abbruch.

**Wichtig:** Nach `adopt` das Profil `media` von SkyHub **nicht**
aktivieren und `docker-compose.storage.yml` **nicht** als Overlay für
einen allgemeinen `docker compose up --profile media`-Befehl benutzen:
das könnte sonst einen zweiten MinIO-Server anlegen.
Die eigene extern verwaltete MinIO-Instanz bleibt unabhängig vom
SkyHub-Compose. Für künftige Backend-Neuerstellungen das zusätzliche
Overlay `docker-compose.storage.external.yml` nutzen (nur Backend-Netz),
oder den Backend-Container gezielt erneut mit `attach` verbinden.
Die Alias-Verbindung zum fremden MinIO muss auch in **dessen** Compose
dauerhaft eingerichtet werden; manuelle Docker-Netzverbindungen können
bei Container-Neuerstellung verloren gehen.

## 5. Weitere bestehende Pi-Container gezielt verbinden

```bash
bash scripts/pi-minio-network.sh attach MEIN_WORKER_CONTAINER
```

Dieser Befehl fügt **nur** ausdrücklich benannte laufende App-Container
dem gemeinsamen Netz hinzu, ohne sie neu zu starten oder Secrets zu
verteilen. PostgreSQL, Redis, EMQX, Mosquitto, Caddy und MinIO selbst
werden durch den Helper bewusst abgelehnt. Dienste mit
`network_mode: host` benötigen eine gesonderte Architekturentscheidung.

**Wichtig:** `docker network connect` ist kein dauerhafter Compose-
Konfigurationsersatz. Bei einer späteren Container-Neuerstellung muss
der Dienst in **seinem eigenen** Compose dauerhaft dem externen
Netz beitreten, beispielsweise:

```yaml
services:
  processor:
    networks: [default, skyhub_storage]
    environment:
      S3_ENDPOINT: http://skyhub-minio:9000
networks:
  skyhub_storage:
    external: true
    name: skyhub-storage-net
```

**Keine** S3-Schlüssel in Git oder Compose-Quelltext hinterlegen.
Per-Service-Accounts, individuelle Policies und Bucket-Rechte sind
zuerst einzurichten. Netzwerkmitgliedschaft allein verleiht
keine Objektberechtigung. Auch eine Netzverbindung ist kein Ersatz
für die S3-Authentifizierung.

### SkyHub-Backend nach späteren Updates

Der vorhandene `scripts/pi-update-backend.sh` arbeitet bewusst **ohne**
Storage-Overlay. Wird das Backend damit neu erstellt, kann die manuelle
Netzwerkverbindung entfallen. Danach den laufenden Backend-Container erneut
mit `attach skyhub-next-backend-1` verbinden und `verify` ausführen.
Für dauerhafte Compose-Netzmitgliedschaft müssen zukünftige Deployments
**beide** Dateien verwenden: für den SkyHub-eigenen MinIO
`docker-compose.storage.yml`, für einen fremden bereits laufenden MinIO
`docker-compose.storage.external.yml`.
Das ursprüngliche Backend-Update-Skript bleibt unverändert und verliert
die manuelle Netzwerkzuordnung bei einem Recreate.

## 6. Daten- und Zugriffsstrategie

Vorgesehene logisch getrennte Buckets (noch **nicht** angelegt):
`skyhub-media-raw` für originale Mavic-3M-Multispektraldaten,
`skyhub-media-derived` für NDVI/Orthomosaik/Ergebnisse und
`skyhub-wpml` für versionierte KMZ-/Wayline-Dateien. Pro Projekt oder
Worker eigene kurzlebige bzw. rotierbare S3-Zugangsdaten und
Bucket-/Prefix-Berechtigungen. Keine öffentliche Bucket-Policy;
verschlüsselte Backups und gegebenenfalls Objektversionierung
separat planen. Upload, Prüfung des Inhalts und Medienindizierung
gehören in eine spätere, authentifizierte Backend-Schnittstelle.

Vor Aufnahme realer Daten: Kapazität auf dem Pi prüfen (SD-Karten-
Schreiblast vermeiden), Offline-Backup des tatsächlichen
`/data`-Mounts erstellen und **Restore auf einem isolierten Ziel
testen**. Ein unverändertes Docker-Volume ist noch kein Backup.

## Prüfgrenzen und Rückbau

`plan` und `verify` sind lesend; `apply` erstellt Netzwerk/Container
und kann beim ersten Start das MinIO-Volume anlegen. `adopt` und `attach`
verändern nur die Netzwerkmitgliedschaft ausgewählter laufender Container.
Kein Skript löscht Daten, startet Legacy-Dienste oder führt
`docker compose down`, `docker volume rm` oder `prune` aus.
Ein einzelner erfolgreicher HTTP-Readiness-Test bestätigt
weder S3-IAM, Bucket-Policies, Backup noch echte Medien-Uploads.
Der Rückbau erfordert separate Prüfung der konsumierenden Dienste;
das persistente Volume bleibt ausdrücklich erhalten.

Referenzen:
- Docker Compose: https://docs.docker.com/compose/how-tos/networking/
- MinIO Community: https://github.com/minio/minio
