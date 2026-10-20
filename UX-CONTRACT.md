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

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Form | `frontend/public/pilot-login.html` für Pilot-Kopplung; Dashboard-Token in `index.html` | `backend/pilot-pairing.js`, `backend/server.js` | Pilot-Kopplung / lesendes Dashboard | Pilot- und HTTP-Zugriffstests |

Weitere Standardkomponenten entstehen erst mit einem tatsächlichen zweiten Workflow. Neue Schreibaktionen benötigen vor der UI-Umsetzung einen expliziten Rollen-, Fehler- und Bestätigungsvertrag; die lesende Karte definiert dafür keine Freigabe.
