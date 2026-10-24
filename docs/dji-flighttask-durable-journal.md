# DJI 1.18 – idempotentes Flighttask-Beobachtungsjournal (isoliert)

Stand: 23.10.2026 · **Nur Offline-/CI-Prototyp. Kein produktiver Missionsstatus.**

## Kontext und Abhängigkeiten

**Integrationsnachtrag 23.10.2026:** [PR #74](https://github.com/mason82-dotcom/SkyHub-Next/pull/74), [PR #78](https://github.com/mason82-dotcom/SkyHub-Next/pull/78) und [PR #83](https://github.com/mason82-dotcom/SkyHub-Next/pull/83) wurden nacheinander in `main` gemergt. Die vorherige gestapelte Review-Basis ist historisch.
Die Entwicklung implementiert **ausschließlich einen isolierten
PostgreSQL-Persistenzadapter**. Weder `backend/server.js` noch
`docker-compose.yml`, der Pi oder MQTT-Dienste werden verändert.

Die Tabellenstruktur ist unter
`backend/db/offline/dji-flighttask-observation.sql` absichtlich **nicht**
Teil von `backend/db/schema.sql`, produktiven Migrationen oder
`track-store.js`. Sie wird nur im dedizierten CI-Datenbankschema erzeugt.

## Persistenz und Integrität

`backend/dji-flighttask-durable-journal.js` bietet den optionalen
`createFlighttaskJournal(db)` mit den Operationen:

| Methode | Vertrag |
| --- | --- |
| `start({workspaceId,observationId,request,ttlMs})` | Initialen, nicht sendenden `flighttask_execute`-Beobachtungszustand speichern; identische Wiederholung gibt denselben Snapshot zurück |
| `read({workspaceId,observationId})` | JSONB-Snapshot strukturell validieren, aus der DB rekonstruieren und einfrieren |
| `apply(key,kind,{topic,payload,now,retained})` | Bestehenden sicheren Parser + Reducer aufrufen; atomare Revisionserhöhung nur bei neuer gültiger Zustandsänderung |
| `recover(key,{now})` | Nach Restart TTL neu bewerten; offene abgelaufene Beobachtung `expired_unverified` und **nicht** `failed` |
| `summary(key)` | Identifikatorfreien Report lesen; `hardwareVerified:false`, `operationVerified:false`, `flightReady:false` |

**SQL-CAS:** Das UPDATE besitzt die Bedingung
`WHERE workspace_id=$1 AND observation_id=$2 AND revision=$3`.
Wird ein Zustand konkurrierend geändert, wird der neueste Snapshot
eingelesen und die Transition erneut geprüft (maximal sechs Versuche).
`INSERT ... ON CONFLICT DO NOTHING` vermeidet doppelte Erstellung.

**Idempotenz:** Wiederholte `services_reply`- und
`flighttask_progress`-Pakete ändern die Revision nicht.
Replay- und Konfliktprüfung stammen weiterhin aus dem bestehenden
Missions-Reducer; die Persistenz überspringt diese Prüfungen niemals.
Ein `result=0`-ACK beendet keinen Flug. Ein späterer
`reported_ok`-Zustand ist eine **Gerätemeldung**, keine
unabhängige Flugfreigabe oder verifizierte Landeoperation.

**Fail-closed:** Ungültige Schlüssel, unerkannte Snapshot-Felder,
unzulässige Readiness-Flags, beschädigte JSONB-Struktur und
nicht korrelierbare Nachrichten werden zurückgewiesen. Datenbankfehler
werden gegenüber dem Aufrufer redigiert.

## Datenminimierung und Sicherheitsgrenzen

Persistiert werden **nur** die zugelassenen Felder:
`request.gatewaySn`, `tid`, `bid`, `flightId`,
Methode, Sende-/Ablaufzeit, gekürzte Reply-Resultate, beschränkter
Missionsstatus und Revisionsnummer. **Keine** Roh-MQTT-Pakete,
GPS-/Telemetriedaten, DJI-Secrets, Tokens, Media-URLs oder Waypoints.

Achtung: Gateway-SN und Flight-ID sind bei späterer Realnutzung
identifizierende Daten. **Vor Produktion fehlen** mindestens
rollenbasierte Workspace-Autorisierung, minimale DB-Rechte,
**produktive** Aufbewahrungs- und Löschregeln (ein [isolierter Offline-Retention-Adapter](dji-flighttask-journal-retention.md) ist bereits in `main`), Backup-Schutz, Verschlüsselung/
Pseudonymisierung sowie Koppelung an eine autorisierte Mission.
Das Journal selbst ist **keine Authentifizierungsschicht** und darf
nicht direkt einer API oder einem beliebigen Client freigegeben werden.
`read` liefert für einen vertrauenswürdigen Backend-Prozess
den internen Zustand einschließlich Korrelations-IDs;
`summary` enthält diese IDs nicht.

## Tests und reproduzierbare CI

Lokale Unit-Tests mit simuliertem DB-Adapter:

```sh
node --test backend/test/dji-flighttask-durable-journal.test.js
```

Der PostgreSQL-Echttest läuft nur mit expliziter
`SKYHUB_TEST_DATABASE_URL` auf einem **Loopback-Server mit der
festen Datenbank `skyhub_test`**. Er legt ein zufälliges
`dji_journal_ci_...`-Schema an, legt dort das Offline-DDL an,
verbindet eine neue PG-Session, prüft die überlebenden Snapshots,
CAS und Replay, und entfernt das Schema. Keine Tabelle in
`public` und keine Produktivmigration werden angelegt.

```sh
node --test backend/test/dji-flighttask-journal.integration.test.js
```

Die CI bindet diesen Test in den bestehenden Job
`isolated-postgis-integration` ein. Alle Geräteseriennummern und
Missions-IDs der Tests sind **synthetisch**.

## Noch nicht entwickelt

- Kein dauerhaft angebundener **produktiver** Storage-Adapter,
  keine Pi-Installation, keine Aufnahme echter Nachrichten.
- Keine Ereignis-Reihenfolgen-Pufferung: Ein vor dem ACK empfangenes
  Ereignis bleibt abgewiesen und wird **nicht** unbemerkt als
  Missionsabschluss übernommen.
- Keine automatische Wiederaufnahme einer Mission nach Restart:
  `recover` prüft **nur** die gespeicherte Beobachtung, es wird
  **kein** DJI-Kommando erneut gesendet.
- Keine `events_reply`- oder DJI-`services`-Publisher.
- Keine Hardware-Freigabe für RC Plus 2, Matrice 4T oder andere Geräte.

**Nur nach separatem Autorisierungs-, Privacy- und Hardware-Review
darf über die produktive Migration entschieden werden.**
