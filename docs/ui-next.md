# SkyHub NEXT Dashboard (`/next/`)

Stand: 22.10.2026, Branch `feature/dashboard-next-ui`. Grundlage ist der hochgeladene Prototyp
`skyhub-next-dashboard-prototype.zip` mit der Roadmap [ui-next-architecture.md](ui-next-architecture.md).
Das bestehende Dashboard unter `/` bleibt unverändert; das neue läuft parallel unter **`/next/`**.

## Analyse des Prototyps

| Teil | Befund | Entscheidung |
|---|---|---|
| `index.html`, `app.js`, `styles.css` | sieben Ansichten (Operations, Mission, Medien, Survey, Thermal, Farm, System), schematische Offline-Karte, alle Gerätedaten synthetisch | übernommen (erster Commit unverändert, Anpassungen im zweiten) |
| Leaflet 1.9.4 | vom CDN `unpkg.com` ohne Integritätsprüfung | lokal unter `next/vendor/leaflet/`; Prüfsummen entsprechen den offiziellen SRI-Werten (Test) |
| Kartenkacheln | OSM, Esri, Carto | beibehalten; die CSP lässt nur diese drei Anbieter zu; `referrerPolicy` gesetzt, weil OSM einen Referer verlangt und SkyHub sonst `no-referrer` sendet |
| `innerHTML` | neun Stellen, Metadaten werden mit `esc()` maskiert | bleibt im Prototypteil; **Live-Daten** werden nur per `textContent` geschrieben (`live.js`, Test) |
| `server.py`, `wpml.py`, `media_extract.py` | Python-Demo-Dienst: Missionsprüfung, KMZ-Export, Bildmetadaten | **nicht übernommen**: das Backend ist Node; ein Export flugrelevanter Dateien braucht Portierung, Tests und Freigabe |
| `wpml.py` | ordnet der M3M die Kamerakennung `68` zu | im Projekt bewusst unbestätigt (nicht in DJIs Produktliste); vor einer Portierung klären |
| Vorschaubilder (PNG, 1,6 MB) | nur Illustration | nicht ins Repository übernommen |

## Was live ist

Die Operations-Ansicht nutzt dieselbe API wie das bestehende Dashboard (nur lesend):

| Element | Quelle |
|---|---|
| Geräteliste | `GET /api/devices`, danach Socket.IO `snapshot`/`device_update`; Gateways zuerst, Verknüpfung RC ↔ Fluggerät, Status „LIVE/VERALTET/GETRENNT“ nach OSD-Frische (15 s) |
| Warnungen | aktive HMS-Meldungen (höchste Stufe zuerst, 30 s) und AirSense-Zusammenfassung |
| Telemetrie-Inspektor | Telemetrie des ausgewählten Geräts mit Alter je Feld (`telemetry-freshness.js`); RTK nach DJI `is_fixed`, GNSS-Stufe, `positionQuality` 10 = RTK fixiert; fehlende Werte „—“ |
| Kennzahlen | frische Geräte, MQTT-Zustand und letztes OSD aus `/api/health` und den Geräten |
| Ereignisse | `GET /api/events` und Socket.IO `device_event` |
| Karte | Live-Positionen (nur frisch, nie `0/0`); Route, Fläche und Geofence bleiben als „Beispiel“ gekennzeichnet; „Karte zentrieren“ zeigt die Geräte |
| System | Backend, MQTT, Lagebild (TSA), Spuraufzeichnung aus `/api/health` |

Anmeldung wie im bestehenden Dashboard: im Heimnetz ohne Token (falls freigegeben), sonst Zugriffstoken.
Das Token bleibt im Speicher der Seite, wird nicht gespeichert und nicht in URLs geschrieben.

## Verifizierte Pilot-2-Medienbibliothek (separater API-Vertrag)

Branch `feature/next-verified-pilot-media-ui-20261023` ergänzt oberhalb der rohen
MinIO-Objektübersicht einen optionalen Viewer für die **isoliert entwickelte**
Workspace-Medienbibliothek aus [PR #39](https://github.com/mason82-dotcom/SkyHub/pull/39).
Der Viewer enthält **keine Freischaltung der API**; insbesondere bleibt deren
`pilot-media-library-http.js` auf dem Dashboard-Basisbranch noch ungemountet.

- Explizite Workspace-UUID und eigener `X-Auth-Token` für Pilot-/Operator-Berechtigung;
  ein Dashboard-View-Token und ein tokenfreier LAN-Zugriff werden nicht übernommen.
- Ausschließlich HTTPS-GET gemäß PR #39: `/api/media-library/v1/workspaces/:workspaceId/assets`
  (20 Objekte pro Seite, maximal 20 durch Benutzer angeforderte Seiten),
  `.../assets/:assetId` (aktuelle S3-HEAD-Verifikation) und
  `.../groups/:groupId/m3m-hints` (begrenzte Gruppenaggregate).
- Die Liste bezeichnet den S3-HEAD-Status ausdrücklich als *bei Registrierung geprüft*;
  die Detailansicht zeigt `HEAD BESTÄTIGT` nur bei passender, erfolgreicher
  **aktueller** Prüfrückgabe. HTTP 409 zeigt fehlende/abweichende Belege.
- Der Client akzeptiert ausschließlich die dokumentierten Version-1-Antwortformen
  und festgelegten Felder. Private S3-Keys, Pilot-Positionsmetadaten,
  unbekannte Felder, XMP-Rohdaten und CaptureUUIDs gelangen nicht in die UI.
- Bandhinweise sind ausschließlich anhand von Dateinamen abgeleitet. XMP-Verifikation,
  NDVI-/NDRE-Berechnungen, Reflektanz- und radiometrische Freigaben
  bleiben ausdrücklich **nicht verfügbar**.
- Token bleiben nur im flüchtigen Seitenzustand, kein Browser-Speicher, keine
  URL-Token, kein Medien-Download und keine Schreibbefehle. Workspace-Wechsel
  verwirft den bisherigen Anmeldestatus.

Die zusätzliche XMP-Probe aus [PR #40](https://github.com/mason82-dotcom/SkyHub/pull/40)
ist **nicht** mit dem HTTP-Viewer verbunden; die dort dokumentierte sichere
isolierte Ausführung und reale Hardware-Abnahme stehen aus.

**Freigabesperre:** Die UI wird erst nach separater Backend-Integrationsprüfung,
Migration-/Rollback-Plan, workspacegebundener Authentifizierung und erfolgreichem
Pi-HTTPS-Browsertest als funktionierende Medienbibliothek bezeichnet.
Dieser Branch startet keine DJI-, MinIO-, Postgres- oder Pi-Dienste.

## MinIO-Objektübersicht: echte Daten, keine Metadaten-Extraktion

Ab Branch `feature/next-readonly-media-explorer-20261022` bietet `/next/` oberhalb der
**unveränderten synthetischen Medienbeispiele** eine separate, geschützte MinIO-Objektübersicht.
Sie nutzt ausschließlich vorhandene Backend-Routen:

- `GET /api/media/status`: Status des lesenden Medien-Backends.
- `GET /api/media/buckets`: vorhandene Buckets aus der festgelegten Allowlist.
- `GET /api/media/objects?bucket=…&prefix=…&limit=50`: Objektschlüssel, Byte-Größe und S3-Änderungszeit; nur eine Seite pro Klick, maximal 50 Einträge pro Seite und maximal 20 Seiten pro gestarteter Pagination. Kein automatischer Vollscan.

**Authentifizierung:** Das Media-Modul benötigt den `SKYHUB_VIEW_TOKEN` als Bearer-Token;
tokenfreier LAN-Gerätezugriff reicht nicht. Die UI fragt das Token deshalb separat ab,
hält es ausschließlich im JavaScript-Sitzungsspeicher und leert das Passwort-Eingabefeld.
Es wird weder in eine URL noch in Browser-Speicher geschrieben. Ein HTTP 401 verwirft das Token.
Falls `SKYHUB_MEDIA_ENABLED` nicht aktiviert ist (HTTP 404), wird dies angezeigt;
die UI aktiviert den Dienst **nicht** selbst.

**Datengrenzen:** Ein S3-Eintrag ist keine verifizierte DJI-Aufnahme. Es werden weder
Bildinhalte, Vorschaubilder, Hashes, EXIF/XMP, Sensoridentitäten, Radiometrie noch
Capture-Gruppen behauptet. S3-Objektschlüssel können private Namen und Pfade enthalten;
die Darstellung ist nur für autorisierte Betrachter gedacht.
Der Browser schreibt fremde Strings nur mit `textContent`, verwirft fehlerhafte
Pagination-Antworten und bricht alte Requests bei Bucket-/Prefix-Wechsel ab.
Kein POST, PUT, DELETE, Download, MinIO-Neustart oder Deployment.

**Abnahme:** `backend/test/ui-next-media.test.js` deckt Bucket-Allowlist, fehlerhafte
API-Antworten, XSS-Textgrenze, Cursorregeln und nur lesende Fetch-Aufrufe ab.
Ein echter Pi-Browser-Test der neuen Ansicht bleibt separat erforderlich.

## Weiterhin Prototyp (Beispieldaten)

Mission Studio (lokale Formprüfung, **kein** KMZ-Export), Medien-Demoassets (**keine** Originalprüfung),
Survey, Thermal und Farming. Die betroffenen Schaltflächen sind deaktiviert und erklären, dass der Dienst im
SkyHub-Backend fehlt.

**DJI Thermal SDK:** nicht integriert. Der Thermal-Bereich zeigt ein synthetisches Bild ohne Temperaturen.
Eine Anbindung bräuchte die DJI-Bibliothek (Lizenzannahme, Linux-Build für die Pi-Architektur prüfen) in
einem getrennten, nicht öffentlichen Prozess und echte R-JPEG-Dateien aus M3T/M4T.

## Sicherheit

- Eigene CSP für `/next`: Skripte nur vom eigenen Server, keine Inline-Skripte oder Inline-Handler, Bilder nur
  von SkyHub und den drei Kachelanbietern, Verbindungen nur zum eigenen Server.
- Keine CDN-Abhängigkeit mehr für Skripte oder Stylesheets.

## Prüfung

- `backend/test/ui-next-model.test.js`: Status, Positionen, Beschriftungen, Kennzahlen (Node).
- `backend/test/ui-next.test.js`: keine externen Quellen, Ladereihenfolge, Leaflet-Prüfsummen, keine
  HTML-Zuweisung für Live-Daten, deaktivierte Exporte.
- `backend/test/http-access.test.js`: CSP auf `/next/`, bestehendes Dashboard unverändert.
- Manuell in Chromium (ohne Fenster): Anmeldung, Live-Verbindung zu einer abgeschotteten Vorschau-Instanz,
  OSM-Kacheln unter der CSP, Gerätekarten und Inspektor mit Beispieldaten; keine CSP-Verstöße.
