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

## Weiterhin Prototyp (Beispieldaten)

Mission Studio (lokale Formprüfung, **kein** KMZ-Export), Medien (Beispielassets, **keine** Originalprüfung),
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
