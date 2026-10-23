# SkyHub-Next — isolierter PV-PostgreSQL-Konkurrenztest (23.10.2026)

**Status:** Entwicklungsbranch, kein Produktivmodul. Kein Merge und keine
Veränderung der laufenden Pi-/Legacy-SkyHub-Dienste.

## Zweck

Die neue Datei `backend/test/pv-postgres-concurrency.integration.cjs` überprüft
**echtes PostgreSQL 16** auf den zentralen SQL-Eigenschaften einer künftigen
PV-Jobwarteschlange. Es handelt sich bewusst um einen eigenständigen
**SQL-Vertragstest** und **nicht** um den bereits vollständig integrierten
`pv_job_store.cjs` aus dem separaten Offline-Prototyp.

Geprüft werden:

1. Zwei unabhängige PostgreSQL-Verbindungen und `FOR UPDATE SKIP LOCKED`.
2. Parallele Beanspruchung desselben wartenden Jobs.
3. Eindeutigkeit eines Idempotenzschlüssels und FK zu verifizierten Medien.
4. Transaktions-Rollback bei fehlgeschlagenem Audit.
5. Race zwischen Heartbeat und Jobabschluss.
6. Ablauf der Lease, konkurrierende Recovery und Zurückweisung verspäteter Ergebnisse.

## Sicherheit

- **Eigener GitHub-Runner**, PostgreSQL-16-Service im kurzlebigen CI-Job.
- Loopback-Port `127.0.0.1:55439`; Test-DB `skyhub_pv_ci`.
- Bootstrap über den ausschließlich im CI-Container vorhandenen Administrator.
  Der Test selbst verwendet `pv_ci` ohne Superuser-/Createdb-/Createrole-Rechte.
- Explizite `CI`, `GITHUB_ACTIONS` und `PV_CI_DISPOSABLE=yes` als Startbedingung.
- Test-Schema mit zufälliger Kennung; bei normalem Ende `DROP SCHEMA ... CASCADE`.
  Vorher werden DB-Identität, Rollenrechte und leeres Ausgangsschema geprüft.
- Kein Zugriff auf DJI Cloud API, MinIO, MQTT, Pi, SSH oder Produktions-Geheimnisse.
- Keine Produktionstabellen, keine Migration von SkyHub-Next.
- `on.push` ist **auf diesen einzelnen Feature-Branch und relevante Dateien begrenzt**,
  weil ein nur im Feature-Branch vorhandener `workflow_dispatch`-Workflow
  nicht zuverlässig über die GitHub-Actions-Oberfläche gestartet werden kann.
  GitHub-Token besitzt nur `contents: read`.

## Abgrenzung zu den bereits erstellten Offline-Paketen

Das bisherige Paket `skyhub-pv-postgres-ci-preview.zip` umfasst darüber hinaus
Medien-Staging, Decoder-Kandidaten, Lease-Supervisor, einen eigenen `pv_job_store.cjs`
und viele lokale Unit-Tests. Diese Module liegen **noch nicht** im aktiven
SkyHub-Repository. Der neue Branch beweist daher zunächst nur die SQL-Semantik
in einer isolierten CI-Datenbank, nicht die Funktionsfähigkeit der gesamten
Python-/Node-/MinIO-/DJI-Pipeline.

Ein grüner GitHub-Actions-Lauf ist notwendig, aber **nicht hinreichend** für
die Freigabe des vollständigen Job-Runner-Pakets.

## Prüfen

GitHub Actions → `PV disposable PostgreSQL 16 contract`. Nach jeder Änderung
am Test oder Workflow auf `feature/pv-postgres-concurrency-ci-20261023` wird
dieser begrenzte CI-Job ausgeführt, sofern GitHub Actions für das Repository
aktiviert ist.

Erst nach einem tatsächlichen erfolgreichen PostgreSQL-Lauf:
- den vollständigen, bisherigen `pv_job_store.cjs` in einen isolierten
  Entwicklungszweig integrieren;
- dieselben Parallelitätstests gegen **seine** Transaktionsmethoden ausführen;
- Wechselwirkungen mit der verifizierten Pilot-2-Medienbibliothek testen;
- anschließend echte R-JPEG-Testbilder gegen das DJI Thermal SDK validieren.

Die bestehenden allgemeinen SkyHub-CI-Jobs laufen separat weiter;
dieser Test wird **nicht** über das allgemeine `backend/test/*.test.js`-Glob gestartet.
