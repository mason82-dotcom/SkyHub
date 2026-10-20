# P2: Internes DJI-Kartenelement-Schreibprotokoll (Entwurf)

Stand: 21.10.2026. **Nicht mit DJI Pilot 2 verbunden. Keine produktiven Schreibendpunkte.**

## Architektur

Der isolierte Baustein `backend/map-element-mutation.js` bereitet elementbezogene Create/Update/Delete-Operationen vor, ohne in `backend/server.js` importiert zu werden. Er exponiert keine HTTP-Route, keinen Socket.IO-Handler und keinen DJI-MQTT-Publisher. Das existierende `mapAccess()`-Modul verweigert weiterhin **alle** Schreibaktionen.

`backend/db/migrations/002_dji_map_mutation_contract.sql` ist ein **nur für isolierte Tests vorgesehener** additiver Entwurf nach Migration 001; er wird nicht vom Serverstart oder Compose angewendet. Er ergänzt `revision BIGINT NOT NULL DEFAULT 1` pro Element und ein Audit-Journal (`dji_map_element_audit`) mit Workspace, Gruppe, Element, Aktion, Akteur-ID sowie alter und neuer Revision. Es werden keine JWTs, Passwörter oder Gerätetokens protokolliert. Das Audit-Journal wird nicht beim Löschen eines Elements gelöscht; Gruppen können aufgrund des Audit-Fremdschlüssels mit historischen Einträgen nicht einfach gelöscht werden.

## Sicherheits- und Konfliktregeln

- Nur ein **serverseitig beglaubigter, später einzuführender** `operator`- oder `admin`-Principal mit eindeutigem Akteur-Identifier und exakt passendem UUID-Workspace kann der internen Transaktionsfunktion übergeben werden. Die Funktion allein ist **kein Authentifizierer**: Ein späterer HTTP-Adapter darf keine Rolle, Actor-ID oder Workspace aus Client-JSON übernehmen. Der aktuelle Pilot- und Dashboard-Tokenresolver erzeugt keine entsprechenden Principals.
- Ungültige IDs, Aktionen, Revisionen und GeoJSON-Geometrien werden vor Aufbau einer Datenbankverbindung abgewiesen. Der vorhandene DJI-Element-Normalisierer begrenzt WGS84-Koordinaten und Geometriekomplexität.
- Je Mutation wird die Gruppe per `SELECT ... FOR UPDATE` gesperrt; `is_locked=true` und `NULL` verhindern Änderungen **auch für Administratoren**. Ein separates autorisiertes Unlock-Konzept fehlt und ist nicht Teil dieses Schritts.
- `create` benötigt eine freie Element-ID; `update` und `delete` erfordern eine explizite, positive `expectedRevision`. SQL-Statements nutzen `WHERE revision = $n` als Compare-and-Swap. Veraltete Revisionen oder doppelte IDs ergeben `conflict`; der gesamte Vorgang wird zurückgerollt.
- Erfolgreiche Schreiboperation und der Audit-Eintrag stehen in **derselben Transaktion**. Ein Auditfehler rollt auch die Elementänderung zurück. Nach erfolgreichem `COMMIT` liefert die interne Funktion die neue Revision (bei Delete `null`).
- SQL-Fehler werden nicht in späteren API-Antworten ausgegeben. Die Logik schreibt keine MQTT-, WebSocket- oder DJI-Steuerdaten und triggert keine anderen Dienste.

## Nachweise

`backend/test/map-element-mutation.test.js` testet Rollen/Spoofing, Invalid-Payloads vor der DB, gesperrte Gruppen, Konflikte, Revisionswechsel, Audit-Tombstones und atomaren Rollback. `backend/test/map-element-mutation.integration.test.js` prüft dieselben Invarianten gegen PostgreSQL 15/PostGIS unter einer **einzig zulässigen Loopback-Testdatenbank `skyhub_test`**. Die Testtabellen entstehen in einem zufälligen Schema und werden nach der Prüfung vollständig entfernt. Der GitHub-Actions-Job `isolated-postgis-integration` startet die echte SQL-Probe zusätzlich zur bestehenden Read-/Track-Suite.

## Noch erforderlich vor produktiven Schreibwegen

1. Vertrauenswürdige authentifizierte Operator-/Administratoridentität mit serverseitiger Workspace-/Rollenzuordnung, Widerruf und Sitzungs-/CSRF-Schutz.
2. Ausgearbeitetes Rechte- und Freigabekonzept für geteilte/private Gruppen, is_lock, Ownership, Protokollierung, Rate Limits und Idempotency Keys.
3. DJI-konforme Create/Update/Delete-HTTPS-Verträge einschließlich Datenvalidierung, HTTP-Status und aktiver Pilot-2-Hardwareabnahme.
4. Transaktional abgesicherte WebSocket-Aktualisierungen nach bestätigtem Commit (Outbox/Retry), Konfliktdarstellung und Offline-Synchronisierung.
5. Separate Migration an einer anonymisierten Bestandskopie, Schema-Backup und explizite Pi-Freigabe.

Das implementierte Modul ist **kein produktiver Schreibpfad**. Weder `SKYHUB_DJI_MAP_ELEMENTS_ENABLED` noch andere Feature-Flags werden geändert.
