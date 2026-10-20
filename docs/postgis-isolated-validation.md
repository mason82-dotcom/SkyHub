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

Ein erfolgreicher Transaktions-Rollback beweist DDL-Verhalten in einer **isolierten** Datenbank, nicht das Wiederherstellen eines externen PostgreSQL-Dumps oder ein unterbrechungsfreies Live-Upgrade. Vor Aktivierung fehlen weiterhin ein echter Dump-/Restore-Probelauf mit einer separat geklonten Datenbank, ein Berechtigungsmodell für Pilot-/Workspace-Rollen, Hardwarevalidierung der Pilot-2-Kartenelementanzeige und eine Entscheidung über Backup/Schema-Migrationsbetrieb. Kein automatisches Anwenden von 001_dji_map_elements.sql beim Serverstart.

Der parallel offene Cleanup-PR #4 betrifft main und ist separat zu integrieren. Die CI-Dateien beider Linien werden beim Zusammenführen fachlich konsolidiert, nicht unbesehen überschrieben.
