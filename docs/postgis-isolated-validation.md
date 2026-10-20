# Isolierte PostGIS-Validierung (Roadmap P1/P2)

Stand: 21.10.2026. Diese Prüfung betrifft ausschließlich die aktive Root-Implementierung auf dem Feature-Branch. Sie ist **kein Produktiv-Rollout**.

## Ziel und Schutzgrenzen

Der Opt-in-Test unter backend/test/postgis.integration.test.js führt tatsächlich SQL gegen eine dedizierte PostgreSQL-15/PostGIS-Testinstanz aus. Ohne SKYHUB_TEST_DATABASE_URL wird er von der normalen Node-Test-Suite übersprungen.

- Datenbankname muss exakt skyhub_test sein; der Host muss Loopback sein. Andernfalls wird **vor der Verbindung** abgebrochen.
- Alle Testtabellen, Migrationen, Inserts und Retention-Deletes erfolgen innerhalb **einer Transaktion mit abschließendem ROLLBACK** und einem zufälligen separaten Schema.
- Tests greifen weder auf DATABASE_URL noch auf den aktiven SkyHub-PostGIS-Container, EMQX, Redis, Caddy, Pilot 2 oder DJI-Hardware zu.
- Keine CI-Verbindung zum Pi; PostGIS läuft als ephemerer GitHub-Actions-Service.
- Die DJI-Kartenelementroute bleibt mit SKYHUB_DJI_MAP_ELEMENTS_ENABLED=false deaktiviert; weder Pilot-2-JSBridge noch Schreib- und Synchronisationsrouten werden aktiviert.

## Prüffälle

1. Frisches backend/db/schema.sql erzeugt die PostGIS-Basistabellen. Die additive Track-Migration ist wiederholbar.
2. Die DJI-Kartenelementmigration erstellt Tabellen, wird über einen Savepoint zurückgerollt und anschließend zweimal erneut ausgeführt (DDL-Idempotenz).
3. Zwei Arbeitsbereiche mit derselben Gruppen-ID bleiben auf SQL-/Adapter-Ebene getrennt. Eine ungültige Fremdschlüsselreferenz über Workspace-Grenzen hinweg wird von PostgreSQL abgewiesen.
4. Leere App-Shared-Gruppen, Sichtbarkeits- und Gruppenfilter bleiben erhalten; ungültige GeoJSON-Koordinaten erscheinen nicht in der Antwort.
5. Reale Track-Inserts/Reads mit PostGIS-Geometrie erhalten Quellzeitstempel, filtern historische (0, 0)-Punkte und löschen bei Retention nur veraltete Testpunkte.
6. Nach der Prüfung erfolgt ein Transaktions-Rollback – auch nach Assertionsfehlern.

CI: .github/workflows/skyhub-next-tests.yml, separater Job isolated-postgis-integration mit postgis/postgis:15-3.5 und einer nur im CI-Runner gültigen Test-Credential. Dieser Job benötigt keine SkyHub-Live-Secrets.

## Einschränkungen / verbleibende Abnahme

Der Transaktions-Rollback-Test beweist das isolierte DDL-Verhalten. Der separate pg_dump/pg_restore-Test (unten) ergänzt einen tatsächlichen Archiv-Restore mit **synthetischen** Daten. Beide ersetzen weder die Wiederherstellungsprobe eines realitätsnahen, anonymisierten Bestands noch die Prüfung von RPO/RTO, Version-Upgrades oder ein unterbrechungsfreies Live-Upgrade. Vor Aktivierung fehlen weiterhin ein Berechtigungsmodell für Pilot-/Workspace-Rollen, die Hardwarevalidierung der Pilot-2-Kartenelementanzeige und die Entscheidung über Backup/Schema-Migrationsbetrieb. Kein automatisches Anwenden von 001_dji_map_elements.sql beim Serverstart.

Der parallel offene Cleanup-PR #4 betrifft main und ist separat zu integrieren. Die CI-Dateien beider Linien werden beim Zusammenführen fachlich konsolidiert, nicht unbesehen überschrieben.

## Getrennter Backup-/Restore-Test mit echtem Archiv (P1)

Der CI-Job `isolated-postgis-backup-restore` führt `scripts/ci-postgis-restore.sh` aus. Das Skript startet ausschließlich einen **selbst erzeugten kurzlebigen PostGIS-15-Container** mit `--network none`, ohne Host-Ports und mit temporärem Datenverzeichnis (`tmpfs`). Das Skript akzeptiert **keine** Datenbank-URL und **keine** bereits existierenden Container als Ziele. Voraussetzung sind `GITHUB_ACTIONS=true`, `CI=true` und `SKYHUB_CI_RESTORE_TEST=isolated`; bei geerbter `DATABASE_URL` oder `SKYHUB_TEST_DATABASE_URL` wird abgebrochen.

Nach abgeschlossenem Init-Prozess und PostGIS-Bereitschaft werden Root-Schema und der unveränderte DJI-Migrationsentwurf in der synthetischen Datenbank `skyhub_test` geladen. Synthetische Mehr-Workspace-Gruppen, GeoJSON-Kartenelemente und PostGIS-Flugspuren bilden den Testbestand. Ein echtes `pg_dump --format=custom` wird mit `pg_restore --list` geprüft und danach in die separate Testdatenbank `skyhub_restore_test` eingespielt.

Mit `tests/fixtures/postgis-restore-verify.sql` werden vor und nach dem Restore dieselben Invarianten geprüft: Gruppen/Elemente mit getrennten Workspace-IDs, leere App-Shared-Gruppe, vollständige GeoJSON-Geometrie und Zeitstempel, Flugspur und WGS84-Geometrie, GIST-Index sowie zusammengesetzter Workspace-Fremdschlüssel. Beim Verlassen des Skripts werden Container, Datenverzeichnis und Archiv gelöscht.

**Abnahmegrenze:** Dieser Test belegt ein echtes `pg_dump`/`pg_restore` für rein synthetische Daten, nicht die Wiederherstellbarkeit der produktiven Raspberry-Pi-Datenbank, verschlüsselter Offsite-Backups, externer Medienbestände oder eines gleichzeitigen Live-Betriebs. Für produktive Einsätze bleiben ein separater Restore einer sicher anonymisierten Sicherung, Aufbewahrung, RPO/RTO und Berechtigungsfreigaben offen.
