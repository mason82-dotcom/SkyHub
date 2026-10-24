# SkyHub Smart Farming P3.5b – private Referenzpanel-ROI-Abnahme

**Stand:** 24.10.2026. Experimenteller, isolierter Draft-Branch auf P3.5a #131 → P3.4 #128 → P3.3 #125 → P3.2 #122 → #117 → #116 → #115 → #114 → #113 → #104.

## Zweck und zwingende wissenschaftliche Grenze

Der Read-only-Worker `backend/workers/m3m_private_panel_consistency.py` berechnet für **zwei bis vier nicht überlappende, privat bereitgestellte WGS84-Panelpolygone** den Vergleich zwischen operatorseitig behaupteten Panelreflektanzen und den vier Float32-Rasterkanälen Red/Green/Red Edge/NIR. Die Panel-Polygone werden nach EPSG des numerischen GeoTIFFs transformiert, nur enthaltene Pixelmittelpunkte werden ausgewertet (`all_touched=False`), und NoData-Pixel sind von der Messung ausgeschlossen.

**Sehr wichtig:** Weder Pixelberechnungen noch die angegebenen Panelwerte sind ein Nachweis, dass ein echtes DJI-Mavic-3M-Sensor-/DLS-/Panelkalibrierungsverfahren korrekt durchgeführt wurde. Das Labor **korrigiert keinerlei Originalwerte**, kennt keine DJI-Seriennummer, XMP-Kameraauthentizität, Panelzertifikate, Labormessnorm oder DLS-Verarbeitung und publiziert keine Flächen-/GPS-Daten. Selbst ein positives `allPanelsWithinOperatorProvidedUncertainty` bleibt ausschließlich ein numerischer Plausibilitätsbefund unter den vom Betreiber gesetzten Unsicherheitsannahmen.

## Eingangsvertrag

- Der `--bundle` ist der bestehende, extern SHA-256-gepinnte experimentelle M3M-Rasterbundle, mit `--seal` und dem unabhängig gespeicherten `--seal-sha256`. Er muss **vor und nach** der Analyse die komplette 11-Dateien-Integrität samt NDVI-/NDRE-/GNDVI-/OSAVI-Formelprüfung bestehen.
- `--panels-file` ist eine **private** JSON-Datei in einem nicht gesymlinkten Verzeichnis mit nur Owner-Zugriff (0700). Der separate `--panels-sha256` muss vor Aufruf unabhängig festgehalten werden; der Worker ermittelt ihn nicht selbst aus den gelieferten Daten.
- JSON-Hauptfelder: `schema`, `classification`, `samples`, `captureProvenanceVerified=false`, `panelInstrumentTraceabilityVerified=false`, `radiometricCalibrationVerified=false`, `operationalUseAllowed=false`. `schema` = `skyhub-m3m-private-panel-observations-v1`; `classification` = `operator-supplied-panel-measurements-unverified-independent-provenance`.
- `samples` enthält **zwei bis vier** individuelle Objekte mit `panelId` (1–32 ASCII-Buchstaben/Ziffern/Unterstrich/Bindestrich), `geometry` (einfaches WGS84-Polygon, geschlossener Außenring, keine Löcher, höchstens 256 Vertices und maximal 0,25° Breite/Höhe), `operatorReferenceReflectance` und `operatorAbsoluteUncertainty`. Beide Werteobjekte enthalten genau vier Float-/Integer-Zahlen für `red`, `green`, `red_edge`, `nir`. Referenzreflektanz muss im Wertebereich 0–1 liegen, angenommene absolute Unsicherheit bei 0,001–0,25.
- Das Gesamtabfragebudget beträgt maximal 250.000 **eindeutige** Pixel. Leere Panelbereiche oder Polygonüberschneidungen im numerischen Raster werden abgewiesen, da mehrfach gezählte identische Pixel keine unabhängigen Wiederholungsmessungen sind.
- Quellbänder müssen auf identischen, numerischen Rastergittern (CRS, Transform, Breite/Höhe, Float32, NoData=-9999) liegen. Jeder Panelbereich muss in jedem Spektralband mindestens einen gültigen Messpixel liefern.
- Panels dürfen **nicht** in `frontend/public/` oder GitHub eingecheckt, per öffentlichem HTTP angeboten oder mit Flight-/Agras-Aufträgen verbunden werden.

## CLI-Beispiel (nur isolierter Entwicklerrechner)

```bash
python3 backend/workers/m3m_private_panel_consistency.py \
  --bundle /privat/m3m-rasterpaket \
  --seal /privat/unabhaengiger-raster-seal.json \
  --seal-sha256 EIN_UNABHAENGIGER_SHA256 \
  --panels-file /privat/referenzpanels.json \
  --panels-sha256 EIN_ZWEITER_UNABHAENGIGER_SHA256
```

Ausgabeformat `skyhub-m3m-private-panel-consistency-v1`: je Band Anzahl Panels/Pixelsamples, mittlere vorzeichenbehaftete und absolute Abweichung, maximaler Betrag und Anzahl Panel-Flächen innerhalb **operatorseitig genannter** Unsicherheit. `allPanelsWithinOperatorProvidedUncertainty` ist die einfache Konjunktion über die vier Bänder. Kein Messwert aus PNG-Vorschauen. Keine Koordinaten, Feldnamen, Panel-IDs oder Dateipfade in Standardoutput.

Alle Bereitschaftsflags bleiben **false**, ausdrücklich `radiometricCalibrationVerified`, `captureProvenanceVerified`, `independentPanelMeasurementsVerified`, `bandCoregistrationVerified`, `reflectanceReady`, `ndviReady`, `ndreReady`, `operationalUseAllowed`, `prescriptionExportAllowed` und `flightMissionAllowed`.

## Abnahme und weiter fehlende Gates

`tests/test_m3m_private_panel_consistency.py` verwendet echte **synthetische GeoTIFFs** mit georeferenzierten Pixeln und unabhängig erzeugtem 11-Dateien-Siegel. Tests: zwei disjunkte Panelpolygone, Rohdaten-/Panel-SHA, numerische Abweichungen, überhöhte Abweichungen, doppelte Panel-Pixel, NoData, ungültige Geometrien/Reflektanzen, Symlink, gefälschte Wissenschaftsflags und spätere Dateiänderungen.

Für echte Hardware-Gültigkeit weiter erforderlich: dokumentierter DJI-M3M-Originaldatenimport und Firmware-/Modellbeleg; DLS-/Sonnenstand- und Referenzpanelmessung einschließlich Seriennummer/Instrumentverifikation; Feld- und Panelgeometrien samt unabhängiger Registrierung; Referenzproben und Unsicherheitsbudget durch qualifizierte Fachstelle; vollständige QGIS-/GDAL-Wiederholbarkeit; echte Workspace-/Asset-RBAC und **keine** Freigabe durch synthetische CI. Kein Deployment oder Merge nach `main` durch diesen PR.
