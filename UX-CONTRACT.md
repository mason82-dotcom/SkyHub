# SkyHub Next UI-Vertrag

## Quellen und Geltung

- Produkt- und Zugriffsgrenzen: [README](README.md#sicherheitsmodell), `backend/lan-access.js` und `backend/server.js`.
- DJI-Fachreferenz und geplante Adapter: [DJI-Referenz-Roadmap](docs/dji-reference-roadmap.md).
- Gilt für das ausgelieferte statische Dashboard `frontend/public/index.html`; die Pilot-2-Webview hat einen getrennten Kopplungsfluss.

## Kartenworkflow

1. Nach erfolgreichem lesendem Geräteabruf zeigt die Liste alle bekannten Geräte. Die Karte zeigt nur endliche, gültige WGS84-Koordinaten mit einem vorhandenen Positionszeitpunkt; `(0, 0)` ist kein nutzbarer Gerätestandort.
2. „Letzte Position auf Karte zeigen“ zentriert die Karte auf genau dieses Gerät. „Alle Positionen zeigen“ passt alle verfügbaren Positionen ein. Diese Aktionen ändern keine Daten und lösen keine DJI-Befehle aus.
3. Eine Markerwahl markiert die zugehörige Gerätekarte und scrollt die Geräteliste zum Eintrag. Der Button in jeder passenden Gerätekarte bietet dieselbe Kartenfunktion per Tastatur.
4. Fehlende Karte, fehlende Positionen und getrennte Live-Verbindung werden als Text angezeigt. Die Liste bleibt bei Kartenfehlern nutzbar. Historische Spurpunkte mit `(0, 0)` bleiben unsichtbar.
5. Der Token bleibt nur im Seitenspeicher; keine URL-, Local-Storage- oder Log-Ausgabe. Der Heimnetz-Zugang ist laut Backend nur lesend.
6. Bei überlappenden Verbindungsversuchen gilt nur der neueste Versuch; verspätete Antworten und Socket-Ereignisse älterer Versuche dürfen Anzeige und Status nicht überschreiben.
7. Der Flugspur-Schalter zeigt direkt darunter den Zustand des lesenden 60-Minuten-Abrufs: Laden, sichtbare Spuren, keine gespeicherte Spur oder Abruffehler. Eine sichtbare Linie benötigt mindestens zwei gültige Punkte. Nach einem Fehler bleiben vorhandene Linien sichtbar und „Erneut laden“ bietet einen direkten Wiederholungsweg.
8. Ausschalten und ein neuer Verbindungsversuch brechen laufende Spurabrufe ab und entfernen bisherige Linien. Verspätete Antworten dürfen weder Linien noch Status eines neueren Abrufs überschreiben. Der regelmäßige Abruf aktualisiert den Status bei Erfolg oder Fehler, ohne jeden Zwischenabruf anzukündigen.

## Geräteliste

- Jede Karte zeigt zuerst Modell, Kennung, OSD-Zustand, Akku, relative Höhe, Position und die höchste aktive HMS-Warnung. Die vollständigen Messwerte, technischen Angaben und HMS-Einträge liegen in einer nativen Aufklappansicht. Ihr Zustand bleibt bei Telemetrie-Updates erhalten.
- Die lokale Suche gleicht Modell, Geräte- und Gateway-Kennung sowie Rolle ab. Der native Statusfilter wirkt nur auf die Liste; Marker und „Alle Positionen zeigen“ bleiben eine Gesamtsicht. Eine Markerwahl setzt verdeckende Filter zurück und zeigt das gewählte Gerät.
- „Aktive HMS-Warnungen“ umfasst Stufen 1 und 2, solange die HMS-Meldung frisch ist. „OSD unter 15 Sekunden“ verlangt frische OSD-Telemetrie und ein nicht getrenntes Fluggerät. Ohne Treffer werden Suche und Filter mit einem Button zurückgesetzt.
- Such- und Filterwerte bleiben während Live-Updates im Seitenspeicher erhalten. Sie werden wegen möglicher Gerätekennungen nicht in URL oder Browser-Speicher geschrieben. Der native Filter nutzt die Popup- und Tastaturbedienung des Browsers.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Form | `frontend/public/pilot-login.html` für Pilot-Kopplung; Dashboard-Token in `index.html` | `backend/pilot-pairing.js`, `backend/server.js` | Pilot-Kopplung / lesendes Dashboard | Pilot- und HTTP-Zugriffstests |
| Select/Listbox | Nativer `<select id="deviceFilter">` in `frontend/public/index.html` | Gerätelisten-Vertrag oben | Einzelauswahl für lokalen Statusfilter | Browser: Tastatur, schmale Ansicht, Popup |

Weitere Standardkomponenten entstehen erst mit einem tatsächlichen zweiten Workflow. Neue Schreibaktionen benötigen vor der UI-Umsetzung einen expliziten Rollen-, Fehler- und Bestätigungsvertrag; die lesende Karte definiert dafür keine Freigabe.
