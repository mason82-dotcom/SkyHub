# SkyHub-Next: M3M Smart-Farming-Konsolidierung (24.10.2026)

## Ziel / Herkunft

Das kanonische Repository ist `mason82-dotcom/SkyHub-Next`.
Dieser Integrationsbranch basiert **direkt auf aktuellem `main`**,
nicht auf dem bereits divergierten Pilot-2-/M3M-PR-Stack.
Der ältere oberste Draft-Branch hatte gegenüber `main`
217 vorausliegende und 53 fehlende Commits; ein direkter Merge würde
fachfremde Features und ältere Main-Versionen einbeziehen.

Am 24.10.2026 wurden 39 spezifische Dateien bytegleich anhand der
GitHub-Blobs der bestehenden M3M-Branches auf `main` übertragen.
Nicht übernommen wurden dessen historische Commits, fremde DJI-/Pilot-2-
Änderungen und die stets joblos fehlgeschlagene Workflowdatei
`.github/workflows/m3m-raster-offline.yml`. Auf dem aktuellen Main
wurden stattdessen genau drei Integrationsstellen angepasst:
`backend/server.js`, `frontend/public/index.html` und
`.github/workflows/ci.yml`.

## Technischer Datenfluss

1. DEDAL-Quellarchiv statisch und ausdrücklich ohne Ausführung prüfen.
2. Private Mavic-3M-TIFF-/Panelinventur anhand separat gepinnter
   Hashwerte; die Bildherkunft/Kalibrierung bleibt unverifiziert.
3. Ein **extern bereits kalibriertes und orthorektifiziertes**
   5-Band-ODM-GeoTIFF entgegennehmen; SkyHub startet DEDAL oder ODM
   nicht selbst.
4. Vier Float32-Reflexionsraster erzeugen und experimentelle
   NDVI-, NDRE-, GNDVI- und OSAVI-Raster berechnen.
5. GeoTIFF-Pixelmathematik, NoData und Statistik unabhängig nachprüfen,
   SHA-256-Sidecar mit **extern kontrolliertem Pin** erzeugen.
6. Einen privaten `candidate.json`-Metadatensatz erzeugen, dessen
   Indexstatistik als experimenteller Kandidat klassifiziert bleibt.
7. Den Kandidaten über einen **standardmäßig deaktivierten**,
   authentifizierten Read-only-Katalog bereitstellen.
8. NDVI-/NDRE-/GNDVI-/OSAVI-Kennzahlen auf einer eigenen statischen
   Smart-Farming-Seite darstellen, ohne GIS-Kacheln oder Freigaben.

## Aktivierung und Datenschutz

Die API `GET /api/smart-farming/candidates/` steht nur bei
`SKYHUB_M3M_CATALOG_ENABLED=true` zur Verfügung. Zusätzlich sind
`SKYHUB_M3M_CATALOG_ROOT` und ein unabhängig autorisierter
`SKYHUB_M3M_CATALOG_SHA256` erforderlich. Die Route nutzt bestehende
SkyHub-Bearer-Authentifizierung zusätzlich innerhalb des Routers.

Das ist **kein** Dashboard-Deployment und keine Empfehlung, die
Funktion im produktiven Pi zu aktivieren. Am Raspberry Pi wurden
keine Umgebungsvariablen, Container, MQTT-Broker, Redis-, MinIO- oder
PostGIS-Daten geändert.

Die Read-only-API bestätigt Kandidatendatei-Hashes am Abrufzeitpunkt,
führt **keine** komplette Raster-QA bei jedem GET aus. Für einen
späteren Tile-Endpunkt wären eine unveränderliche Rasterquelle,
autorisierte Datensatzauflösung, erneute QA am Zugriff und ein
getrenntes GIS-Sicherheitsreview nötig. Alle Ausgabe- und Betriebsflags
wie `operationalUseAllowed`, `flightMissionAllowed` und
`prescriptionExportAllowed` bleiben `false`.

## GitHub-Actions-Abnahme

Der vorherige isolierte M3M-Workflow schlug in allen geprüften
historischen Stacks von PR #48 bis #86 wiederholt fehl;
in den abgefragten fehlgeschlagenen Runs wurden **null Jobs**
ausgewiesen. Das ist noch **keine ermittelte Root Cause**.
Die alte Datei wurde nicht in den Integrationsbranch aufgenommen.

Stattdessen besitzt `.github/workflows/ci.yml` einen eigenen
`m3m-offline-integration`-Job auf einem isolierten GitHub-Runner:

- Python 3.12 und installierte optionale NumPy-/Rasterio-/TIFF-Pakete
- Alle `test_m3m_*.py`-Suites einschließlich synthetischer TIFF-Pixeltests
- Node 22 und gesperrte `backend/package-lock.json`-Dependencies
- Read-only-Katalog, echte lokale HTTP-Authentifizierungs-Tests
- JavaScript-UI-Tests und Tests gegen unzulässige Betriebsfreigaben

Der Haupt-CI-Job führt außerdem die Frontend-Vertragstests aus.
**Ein grünes Ergebnis des neuen Jobs muss vor Merge bestätigt werden.**

## Freigabe-Gates

- **P0:** GitHub-CI und statisches Review aller M3M-Artefakte; keine
  Worker-/Auth-/Raster-Routen ohne negative Regressionstests.
- **P0:** Sicherheitscheck für Datei-/Pfad-/Hash-Pinning, Race Conditions,
  API-Token- und Autorisierungskonzept. Noch keine Kachel-APIs.
- **P1:** Originales DEDAL-Zenodo-Archiv, CLI, Lizenz und Abhängigkeiten
  **tatsächlich** anhand der Originaldatei abnehmen (derzeit nicht belegt).
- **P1:** Reale M3M-Bilder mit allen G/R/RE/NIR-Kanälen,
  Panelreferenz und prüfbarer Bandregistrierung validieren.
- **P1:** Backend- und Mobil-UI-Tests einschließlich Android durchführen.
- **P2:** Erst nach wissenschaftlicher Prüfung und zusätzlichem
  Sicherheitsreview mögliche spätere GIS-Layer oder Agronomieprojekte.

**Missionssteuerung, Dünge-/Spritzkarten, operative Reflektanzfreigabe,
Agras/ISOBUS und produktiver Raspberry-Pi-Deploy sind nicht enthalten.**

## PR-Behandlung

Die ursprünglichen gestapelten Draft-PRs #48, #51, #55, #59,
#64, #72, #77, #79, #82, #84 und #86 bleiben bis zur
technischen Abnahme und Querverweiskorrektur offen.
Dieser konsolidierte Branch benötigt beim späteren Review
**nur einen** Merge nach `main`, nicht elf gestapelte Merges.
Kein automatischer Merge wird vorgenommen.

## CI-Diagnose nach PR #104

Für den konsolidierten Integrationsbranch ist [Draft-PR #104](https://github.com/mason82-dotcom/SkyHub-Next/pull/104) gegen `main` eröffnet.
Am 24.10.2026 ergab die GitHub-Actions-Abfrage Folgendes:

- Die fehlgeschlagenen Push-Runs [#40043496658](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/40043496658)
  und [#40043679645](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/40043679645)
  der CI meldeten **0 ausgeführte Jobs**. Sie sind somit **kein**
  Ergebnis ausgeführter M3M-Testfälle.
- Die ursprüngliche CI-Branch-Liste enthielt kein `integrate/**`.
  Diese wurde um `integrate/**` ergänzt; das allein beseitigte die
  joblosen Fehlermeldungen nicht.
- Auf dem **unveränderten damaligen Main** traten für
  `.github/workflows/m3m-offline-acceptance.yml` ebenfalls
  joblose Fehler auf (unter anderem [#40043353205](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/40043353205)).
  Damit ist ein von dieser Konsolidierung unabhängiger CI-Gate-Blocker
  nachgewiesen; die exakte Ursache auf GitHub-Workflow-Ebene bleibt offen.
- Ein gelaufener TAK-UI-Workflow ist **nicht** gleichbedeutend mit
  einer erfolgreich absolvierten Raster-/Katalog-Testkette.

### Ausweichprüfung ausschließlich in einem getrennten Worktree

Der neue `scripts/m3m-offline-verify.sh` erfordert bewusst
`SKYHUB_M3M_OFFLINE_LAB=1` und installiert selbst keinerlei Pakete.
Er ruft nur synthetische Unit- und Offline-HTTP-Tests auf, ohne Docker,
MQTT, Kamera, S3/MinIO oder PostGIS zu kontaktieren.

```bash
cd ~/Projekte/SkyHub-Next
git fetch origin
git worktree add ~/Projekte/SkyHub-M3M-Review \
  origin/integrate/m3m-smart-farming-20261024
cd ~/Projekte/SkyHub-M3M-Review
python3 -m venv .venv-m3m
. .venv-m3m/bin/activate
python -m pip install --only-binary=:all: \
  -r backend/workers/m3m_requirements.txt
npm ci --prefix backend --ignore-scripts --no-audit --no-fund
SKYHUB_M3M_OFFLINE_LAB=1 bash scripts/m3m-offline-verify.sh
```

Diese Kommandos sind zur **gezielten lokalen Ausführung** dokumentiert;
sie wurden nicht auf dem Raspberry Pi ausgeführt.
Der Worktree darf nicht mit der laufenden Pi-Installation
oder einer produktiven `.env` verwechselt werden. Erst eine erfolgreiche
Testausgabe ist ein lokaler Nachweis; CI bleibt zusätzlich verpflichtend.

Der neue Main-basierte Branch kann zudem gegenüber späteren Main-Commits
zurückliegen. Vor jedem Merge daher erneut `git fetch`, aktuellen
Branchvergleich und eventuelle Konflikte prüfen.
