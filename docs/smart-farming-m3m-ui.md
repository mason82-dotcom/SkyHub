# Experimenteller Smart-Farming-Tab (M3M)

**Stand: 23.10.2026** · Repository
https://github.com/mason82-dotcom/SkyHub-Next

## Neue Oberfläche

Im Entwicklungsbranch `feature/m3m-smart-farming-ui-repo-rename-20261023`
gibt es folgende statische, ohne Frontend-Build lauffähige Dateien:

- `frontend/public/smart-farming.html`: eine getrennte Seite, im
  bestehenden Dashboard als **Smart Farming · Experimentell** verlinkt.
- `frontend/public/smart-farming-ui.js`: validiert die
  API-Schemainhalte und rendert ausschließlich mit `textContent`
  NDVI, NDRE, GNDVI und OSAVI als dimensionslose Kennzahlen.
- `frontend/test/smart-farming-ui.test.js`: isolierte Node-Tests zur
  Indexdaten-Validierung, Informationsminimierung, Tokenbehandlung
  und Vermeidung von Karten-/GIS-Funktionen.

Die Seite fragt nur
`GET /api/smart-farming/candidates/` ab, mit manuell
eingegebenem SkyHub-View-Token im `Authorization: Bearer`-Header.
Das Token wird weder in eine URL noch in Local-/Session-Storage
geschrieben und nach der Anfrage aus dem Eingabefeld gelöscht.

Der Browser zeigt unterscheidbare Zustände für:
ungültigen Token (401), noch nicht aktivierte API (404),
nicht verfügbaren Katalog (503), invalides Datenformat und
einen leeren Kandidatenbestand. Die Anfrage ist ausschließlich lesend.

## Voraussetzung / wichtige Schranke

Die API stammt aus dem vorgeschalteten Draft-PR
[#84](https://github.com/mason82-dotcom/SkyHub-Next/pull/84).
Sie ist ohne `SKYHUB_M3M_CATALOG_ENABLED=true` nicht
gemountet; mit dem Flag müssen zusätzlich ein geschützter
Katalogstamm und ein **unabhängig gepinnter** Manifest-SHA256
gesetzt werden. Diese Konfiguration wurde **nicht** am Pi
verändert. Eine bloße Codeänderung oder ein Draft-PR aktiviert
keinen Endpunkt im laufenden System.

Die API verifiziert den Hash einer privaten
Kandidaten-Registrierung, **nicht** jedes Originalraster bei
jedem GET. Die Oberfläche nennt dies ausdrücklich und setzt
keine Kalibrierungs-, Flug- oder Exportfreigaben.

## Lokal prüfen (ohne Deployment)

```bash
cd ~/Projekte/SkyHub-Next
node --check frontend/public/smart-farming-ui.js
node --test frontend/test/smart-farming-ui.test.js
node --test backend/test/smart-farming-catalog.test.js
# Optional im isolierten Node-Lab mit npm ci:
node --test backend/test/smart-farming-catalog-http.test.js
```

Die HTML-Seite wird als statischer Inhalt vom vorhandenen
`express.static(frontend/public)` bereitgestellt. Daraus
folgt **keine** Freischaltung des Katalog-API-Endpunkts.

## Nächste Gates

Zuerst die GitHub-Actions-Prüfung des neuen PR-Heads auswerten,
danach Browser-/Mobiltests (Chrome Android, Firefox, schmale Screens),
Auth-Review und einen separat versionierten, privaten
Katalog-Testdatensatz abnehmen. Auf realen DJI-M3M-Bildern
sind weiterhin kalibrierte Referenzflächen, Bandregistrierung
und das nachprüfbare DEDAL-Verarbeitungsprotokoll notwendig.

**Keine Kartenkacheln, Geokoordinaten, Sensor-Rohdaten,
Ausbringkarten, Missionssteuerung oder Produktionsfreigabe.**
