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
**nicht automatisch installiertes** Default-Deny-Schema fest:
`FORCE ROW LEVEL SECURITY`, keine erlaubenden RLS-Policies, keine
DB-Grants für einen WPML-Runtime-User. Die neue Implementierung
ändert diese Sicherheitsgrenze **nicht**.

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
- **Transaktion:** Jede Änderung ist `BEGIN`/`COMMIT`; bei Fehler
  erfolgt `ROLLBACK`.

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
in der explizit erlaubten `skyhub_test`-Datenbank. Dort werden
SQL-Transaktionen mit dem administrativen CI-Nutzer nachgewiesen;
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

**Keine der P0-Datenbankoperationen autorisiert Flüge.**
