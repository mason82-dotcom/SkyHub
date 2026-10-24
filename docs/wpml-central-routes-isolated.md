# Zentrale WPML-Routenbibliothek – isolierter P0-Dienst (24.10.2026)

**Entwicklungsbranch:** `feature/wpml-central-route-service-isolated-20261024`
**Betriebsstatus:** **Nicht freigegeben, nicht gemountet, nicht deployen.**

## Ausgangspunkt

Seit [WPML Main-Integration #89](https://github.com/mason82-dotcom/SkyHub-Next/pull/89)
ist der browserlokale Editor Bestandteil der Codebasis. Derzeit existiert
jedoch **keine** eigenständige, verifizierte Operator-Identität für die
zentrale Verwaltung von Flugrouten. Der SkyHub-HTTP-View-Token und
DJI-Pilot-2-Pairing dürfen keine Schreibrechte begründen.

Die bestehende Datenbankdatei
`backend/db/migrations/003_wpml_route_library_draft.sql` legt nur ein
**nicht automatisch installiertes** Default-Deny-Schema fest. Ein
separater ebenfalls **nicht automatisch installierter**
`backend/db/migrations/004_wpml_route_audit_draft.sql` ergänzt das
append-only-Audit. Beide verwenden `FORCE ROW LEVEL SECURITY`,
keine erlaubenden RLS-Policies und keine Grants für einen
WPML-Runtime-User. Die neue Implementierung ändert diese
Sicherheitsgrenze **nicht**.

## Isolierte Module

`backend/wpml-central-routes.js` stellt nur programmatische
`createWpmlRouteService({pool,authorize})` und
`createWpmlRouteStore(pool)`-Fabriken bereit. Es wird **weder**
von `backend/server.js` noch von einem Express-Router importiert.
Es gibt keine neuen öffentlichen URLs, Env-Flags, Broker-Topics,
DJI-Aufträge oder automatischen Migrationen.

Eine Service-Operation benötigt:
1. einen **vom Server injizierten** `authorize(credential)`-Resolver,
   der eine zuvor unabhängig verifizierte menschliche Operator- oder
   Admin-Identität mit UUID und eindeutigem Workspace liefert;
2. die Übereinstimmung dieses Workspace mit der Zieloperation;
3. ein begrenzt validiertes Offline-WPML-Wegpunktmodell,
   einschließlich Ablehnung unbekannter Feldnamen;
4. eine später **separat freizugebende** nichtprivilegierte
   PostgreSQL-Runtime-Rolle mit ausschließlich notwendigem Tabellenzugriff
   und geprüften Workspace-RLS-Policies.

Es ist ausdrücklich **kein** solcher produktionsgeeigneter Resolver oder
DB-Laufzeitbenutzer implementiert. `kind:'human'` und
`source:'independent-operator-auth'` sind ein interner Vertrag und
**keine selbstbeglaubigende Identität**. Niemals diese Werte aus
HTTP-Request-Body, Query, Cookies ohne Verifikation oder DJI-Token
übernehmen.

### Revisionsmodell

- **Create:** parametrisierte SQL-Queries; maximale Routezahl 32 pro Workspace.
  Eine PostgreSQL-Transaktions-Advisory-Lock serialisiert parallele
  Erstellvorgänge desselben Workspace.
- **Append:** `SELECT ... FOR UPDATE` und
  `expectedRevision` als optimistischer Compare-and-Swap. Pro Route
  höchstens 12 Revisionen. Kein UPDATE oder DELETE an alten Revisionen.
- **Read/list:** immer mit `workspace_id` als SQL-Bedingung, keine
  Namen/Koordinaten in Logs; Listen geben keine GPS-Werte aus.
  Eine Revision liefert GPS nur an den separat autorisierten Aufrufer.
- **Integrität:** Aus dem whitelisted WPML-Entwurf wird ein
  kanonischer SHA-256-Fingerprint erstellt. Gelesene Revisionen werden
  erneut normalisiert und gegen die gespeicherte Prüfsumme verglichen.
  `flightReady:false`, `dispatchAllowed:false` und
  `previewOnly:true` werden erzwungen.
- **Transaktion und Audit:** Jede Änderung ist `BEGIN`/`COMMIT`;
  bei Fehler erfolgt `ROLLBACK`. Jeder erfolgreiche Create-/Append-Aufruf
  fügt **in derselben Transaktion** genau einen unveränderlichen
  `skyhub_wpml_route_audit`-Eintrag hinzu. Gespeichert werden ausschließlich
  Workspace-, Routen-, Revisions- und Operator-UUID, fester Ereignistyp
  und Erstellzeit – **niemals GPS-Koordinaten, Missionspläne oder Tokens**.
  Der Audit-Entwurf ist Default-Deny, eine sichere Lese-/Exportschnittstelle
  und eine unabhängige Audit-Retention fehlen weiterhin. Ein fehlgeschlagener
  Audit-Insert **muss** die Route-/Revisionsänderung zurückrollen.

Keine Rollenverwaltung, Folder-CRUD, Team-Sharing, produktiver
Task-Snapshot- oder DJI-Upload-Endpunkt.

## Prüf- und Freigabegates

```bash
node --test backend/test/wpml-central-routes.test.js
# Nur CI-/lokale disposable skyhub_test-Datenbank:
SKYHUB_TEST_DATABASE_URL=postgresql://...@127.0.0.1:55432/skyhub_test \
  node --test backend/test/wpml-central-routes.integration.test.js
```

Die Integrationstests verwenden ein **temporäres separates Schema**
in der explizit erlaubten `skyhub_test`-Datenbank und wenden
`003` sowie `004` ausschließlich dort an. Sie prüfen unveränderliche
Audit-Einträge, Default-Deny-RLS-Metadaten, Audit-/Routentransaktionskopplung
sowie einen gezielt fehlgeschlagenen Audit-Insert samt vollständigem Rollback.
Dort werden SQL-Transaktionen mit dem administrativen CI-Nutzer nachgewiesen;
**dies ist kein Beweis für produktive RLS-Rollenrechte**.

Vor einer Serverfreigabe sind zwingend:
- eigenständige SSO/Operator-Authentifizierung, Workspace-Mitgliedschaft,
  Token-Lebensdauer, Widerruf und Audit-Nachweise;
- eigene PostgreSQL-Nicht-Superuser-Rolle **ohne `BYPASSRLS`**,
  eng begrenzte Grants, `FORCE RLS`-Isolationstest auch bei abgelaufenen
  bzw. bösartig manipulierten Sitzungen;
- Idempotency Keys, nachvollziehbare Audit-Ereignisse, Verschlüsselung,
  DSGVO-Lösch-/Aufbewahrungsregeln und geprüfter DB-Backup-/Restorepfad;
- tatsächliche DJI-Pilot-2-/M3M-/M4T-KMZ-Abnahme vor jeder späteren
  Flugfreigabe, einschließlich Höhen-, Payload- und Kamerasemantik;
- gesondertes Pi-Preflight, Konfigurationsabnahme und Rollback.

## Nichtprivilegierter SQL-RLS-Test (Phase 3)

Der zusätzliche Test `backend/test/wpml-central-rls.integration.test.js`
läuft ausschließlich auf der ausdrücklich angegebenen
`skyhub_test`-Datenbank am lokalen Loopback-Host. Er erstellt drei
temporäre **`NOLOGIN NOSUPERUSER NOBYPASSRLS`**-Rollen und ein
zufällig benanntes, temporäres Schema. Er kontrolliert:

- Bereits vergebene `USAGE`- und `SELECT`-Rechte führen unter
  `FORCE ROW LEVEL SECURITY` **ohne erlaubende Policies zu null sichtbaren
  Datensätzen**, einschließlich Routen, Revisionen und Audit.
- Ausschließlich **im CI-Schema** erzeugte SELECT-Policies gewähren
  je einer Testrolle Sicht auf genau einen fest zugewiesenen Workspace.
  Andere Workspaces bleiben auch bei direkter SQL-Abfrage unsichtbar.
- Eine dritte nicht zugewiesene Rolle liest auch nach Einrichtung
  der beiden Test-Policies **nichts**.
- Selbst nach einem reinen `GRANT INSERT` blockiert die Datenbank ohne
  `FOR INSERT`-Policy den Schreibversuch. Audit und Revisionen
  werden nicht verändert.
- Rollen und Schema werden im Test-Finalizer bereinigt.

Diese Test-Policies sind **nicht Teil der Migrationsdateien**, begründen
keine produktiven SQL-Zugriffe und sind **kein Entwurf für eine
später kopierbare, fest an Workspace-UUIDs gekoppelte Laufzeit-Rolle**.
Die Verwendung privilegierter Datenbankadministration für temporäre
Testrollen dient ausschließlich dem CI-Beweis. Eine echte Rollenzuordnung
zu Operator-Sessions, Tokenwiderruf, DB-Transaktionskontext und
tenant-sichere Policy-Auswertung müssen gesondert entworfen werden.

**Wichtig:** PostgreSQL Custom-GUC-Werte, die ein normaler
DB-Client mittels `SET` selbst festlegen kann, dürfen **nicht**
als vertrauenswürdige alleinige Grundlage einer Workspace-Policy
dienen. Ein Request-Parameter wie `workspaceId` oder
`role:'operator'` ist **niemals** ein Authentifizierungsbeweis.

```bash
# Nur im eigens bereitgestellten isolierten Testsystem:
node --test backend/test/wpml-central-rls.integration.test.js
```

**Keine der P0-Datenbankoperationen autorisiert Flüge.**
