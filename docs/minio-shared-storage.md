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

### Befund am 21.10.2026: zwei gestoppte AeroNexus-MinIO-Container

Auf dem Raspberry Pi wurden sowohl
`aeronexusadvanced-cloud-minio-1` als auch `aeronexus-edge-minio-1`
als `Exited (0)` gemeldet. In `docker volume ls` ist kein
offensichtlich benanntes MinIO-Datenvolume zu sehen. **Aus dieser
Beobachtung folgt nicht, dass keine Daten existieren**: Bind-Mounts,
anonyme Volumes und externe Storage-Verzeichnisse sind möglich.
**Mount-Zuordnung am 21.10.2026 bestätigt:** Beide gestoppten
Server `aeronexusadvanced-cloud-minio-1` und `aeronexus-edge-minio-1`
verwenden denselben **Bind-Mount**
`/mnt/hc4backup/aeronexus-data/minio -> /data`.
Der gestoppte `aeronexus-edge-minio-init-1` bindet dagegen ausschließlich
`/home/mason/Projekte/AeroNexus/evidence/scripts/minio-init.sh`
unter `/init/minio-init.sh` ein. Es gibt damit **einen gemeinsamen
Datenpfad, aber zwei historische Servercontainer**. Ob der Pfad tatsächlich
auf einem eingehängten externen Dateisystem liegt, ist noch nicht geprüft.
Das Image `aeronexus/minio:RELEASE.2025-10-15T17-29-55Z-an1`
wird von beiden Servercontainern verwendet; Herkunft, Sicherheitslage,
verwendete Zugangsdaten und Datenintegrität sind noch nicht geprüft.

**Pflichtprüfung vor jeglichem Containerstart (nur lesen):**

```bash
# Auf dem Pi in einem Checkout mit dem MinIO-PR-Branch:
bash scripts/pi-minio-shared-mount-check.sh
```

Das Skript kontrolliert, dass das Verzeichnis vorhanden ist und sich
auf einem tatsächlich eingehängten **Nicht-Root-Dateisystem** befindet.
Es meldet Filesystem, Kapazität und Container, die denselben
`/data`-Bind-Pfad referenzieren – ohne Bucketnamen oder Secrets
auszulesen. Ist der Datenträger nicht eingehängt, **niemals MinIO
starten**: Ein fehlender Bind-Mount könnte sonst auf dem Pi-Bootmedium
als leeres Verzeichnis entstehen. Ein vorhandenes Verzeichnis oder
`.minio.sys` allein ist weder ein Backup- noch ein Integritätsnachweis.

Vor irgendeinem Start oder `adopt` zunächst rein lesend ausführen:

```bash
cd ~/Projekte/SkyHub-Next
python3 scripts/pi-minio-audit.py
```

Der Report nennt nur Containernamen, Image, Status, Compose-Projekt,
Netzwerke und **Mount-Metadaten**, keine Credentials oder Buckets.
Die angezeigten lokalen Quellpfade können private Verzeichnisnamen
enthalten: vor dem Weitergeben gegebenenfalls anonymisieren.

**Keiner der beiden gestoppten MinIO-Container wird durch `adopt`
gestartet.** Nach individueller Prüfung des Speicherzustands muss
genau ein ausgewählter MinIO-Server kontrolliert in Betrieb genommen
werden. Nur dieser darf laufen, wenn `adopt` aufgerufen wird.
Der zweite Container und der MinIO-Init-Container dürfen im gestoppten
Zustand bleiben und müssen weder gelöscht noch umbenannt werden.
Eine gemeinsame Datenquelle mehrerer Server ist vor dem Start
auszuschließen; ebenso sind Image-Build-Herkunft, Persistenz,
Backups und Abhängigkeiten zu prüfen.

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
# NUR nach erfolgreichem Storage-Audit und kontrolliertem Start
# von GENAU EINEM geprüften alten MinIO-Server:
SKYHUB_MINIO_EXPECTED_DATA_SOURCE=/mnt/hc4backup/aeronexus-data/minio \
  bash scripts/pi-minio-network.sh adopt NAME_DES_BESTEHENDEN_MINIO
bash scripts/pi-minio-network.sh verify
```

Dieser Modus startet **keinen** MinIO-Container, legt keine Buckets an,
wechselt kein Image und ändert weder das MinIO-Datenvolume noch dessen
Credentials. Vor dem Aufruf muss der geprüfte Originalcontainer bereits
bewusst gestartet worden sein und der Backup-Datenträger korrekt
eingehängt sein. Für `adopt` ist die erwartete Quelle von `/data`
**ausdrücklich** als Umgebungsvariable anzugeben, beispielsweise
`SKYHUB_MINIO_EXPECTED_DATA_SOURCE=/mnt/hc4backup/aeronexus-data/minio`.
Bei Abweichung, fehlendem Verzeichnis, Symlink oder Auflösung auf dem
Root-Dateisystem bricht die Übernahme ab. Er prüft vor der Anbindung, dass MinIO läuft, eine
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

## 7. IAM-Rollen und echter S3-Probe (erst nach Hardware-/Storage-Audit)

Vorlagen unter `storage/policies/` definieren **keine** aktiven Berechtigungen.
Sie müssen über eine geprüfte MinIO-Admin-Konsole oder einen vertrauten
`mc admin`-Client **manuell** eingerichtet und je einem getrennten
Anwendungskonto zugewiesen werden. Keine Root-Anmeldedaten an SkyHub-Worker,
keine öffentlichen Buckets oder pauschale `s3:*`-Freigaben.

| Policy-Datei | Zugriff |
|---|---|
| `skyhub-raw-ingest.json` | Originalbilder in `skyhub-media-raw` schreiben/lesen, **kein Löschen** |
| `skyhub-derived-worker.json` | Originalbilder nur lesen, abgeleitete Produkte schreiben/lesen |
| `skyhub-wpml-reader.json` | WPML-/KMZ-Daten nur lesen |
| `skyhub-smoke-probe.json` | Nur isoliertes Testbucket; Objektzugriffe ausschließlich unter `__skyhub_smoke__/` |

Vor der Vergabe Bucket-Namen und die genaue Policy-Kompatibilität mit
der **tatsächlich installierten** MinIO-Version prüfen. Multiparte Uploads
für große multispektrale Fotos sind in der Vorlagenpolitik vorgesehen.
Die Policy-Dateien sind dokumentierte Minimalprofile, keine automatische
IAM-Provisionierung oder Sicherheitsabnahme.

Für einen authentifizierten S3-Test zunächst ein eigenes privates Bucket
`skyhub-storage-smoke` sowie einen Benutzer mit **ausschließlich**
`skyhub-smoke-probe.json` anlegen. Der Test verändert keine DJI-Medien.

Eine **lokale**, nicht versionierte Credential-Datei anlegen:

```bash
mkdir -p ~/.config/skyhub
chmod 700 ~/.config/skyhub
nano ~/.config/skyhub/minio-s3-probe.env
chmod 600 ~/.config/skyhub/minio-s3-probe.env
```

Inhalt (nur Platzhalter; niemals hier wirkliche Schlüssel posten):

```dotenv
SKYHUB_S3_ENDPOINT=http://skyhub-minio:9000
SKYHUB_S3_REGION=us-east-1
SKYHUB_S3_BUCKET=skyhub-storage-smoke
SKYHUB_S3_ACCESS_KEY=REPLACE_WITH_DEDICATED_TEST_ACCESS_KEY
SKYHUB_S3_SECRET_KEY=REPLACE_WITH_DEDICATED_TEST_SECRET_KEY
```

Danach im aktiven SkyHub-Next-Checkout:

```bash
# Authentifiziert, ausschließlich HEAD auf dem Testbucket:
bash scripts/pi-minio-s3-check.sh --read

# Nur nach freigegebenem Schreibtest: zufälliges Objekt unter
# __skyhub_smoke__/ anlegen, lesen, SHA-Abgleich und wieder löschen:
bash scripts/pi-minio-s3-check.sh --write
```

Der Test nutzt das Image des **bereits vorhandenen SkyHub-Backends**,
startet jedoch einen separaten, temporären Node-Prozess-Container mit
`--rm` und `--read-only` im Storage-Netz; das laufende Backend wird
**nicht** neu gestartet. Die private Credential-Datei wird per
`--env-file` an den Testcontainer gegeben, nicht über CLI-Argumente
oder GitHub. Während der kurzen Testlaufzeit kann ein berechtigter
Docker-Administrator die Test-Credentials über Container-Inspektion
sehen – Docker-Host-Administratoren sind Teil der Vertrauensgrenze.
Der Test gibt weder Schlüssel noch Medieninhalte aus. Wenn der
Schreibtest nach PUT fehlschlägt, versucht er im `finally`-Block zu
löschen; einen eventuell verbliebenen Testgegenstand **nur im
isolierten Testbucket** nachträglich prüfen. Für produktive
App-Objekte niemals einen `--write`-Probe verwenden.

**Prüfstufen:** `pi-minio-network.sh verify` bestätigt eine erreichbare
HTTP-Readiness; `pi-minio-s3-check.sh --read` bestätigt den
signierten Bucket-Zugriff; `--write` bestätigt erst einen tatsächlichen
PUT/GET/Hashvergleich/DELETE im dafür vorgesehenen Testbucket.
Keine dieser Prüfungen ersetzt Restore-Test, Object-Versioning-
Konfiguration oder spezifische DJI-Pilot-Medien-Workflows.

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
