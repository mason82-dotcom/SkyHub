# SkyHub Smart Farming – M3M Medieninventar (Phase 1)

Stand: 21.10.2026 · Branch: `feature/m3m-media-inventory-readonly-20261021`

## Evidenzbasiertes Integrationsziel

Die DJI Mavic 3M besitzt **1 RGB-Sensor mit 20 MP** und vier
Multispektral-Sensoren mit je 5 MP: Green (G), Red (R),
Red Edge (RE) und Near Infrared (NIR). Die Kamera speichert
radiometrisch relevante Metadaten einschließlich Sonnenlichtsensor-
Informationen in den Bildern. Die fünf Rohaufnahmen werden für
vegetationskundliche Indizes nicht einfach als normalisierte
Reflektanzwerte interpretiert.

DJI Pilot 2 verwendet für Medienverwaltung über Cloud API
getrennte HTTPS-Endpunkte für Fast Upload/Existenzprüfung,
Tiny Fingerprints, die Ausgabe **temporärer S3-kompatibler**
Storage-Credentials und Upload-Callbacks. Diese Funktionen
erfordern einen erreichbaren Objektspeicher sowie ein geprüftes
Berechtigungs- und Sicherheitskonzept. Sie werden **nicht**
durch MQTT-OSD ersetzt.

Referenzen:
- https://ag.dji.com/mavic-3-m
- https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-media-management.html
- https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/media-management/mediafile-upload-result-report.html
- https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20230829/Mavic_3M_Image_Processing_Guide_EN.pdf

## In dieser Entwicklungsstufe implementiert

- `backend/m3m-media-inventory.js`: rein lokale Gruppierung
  von M3M-Bild**dateinamen** in mutmaßliche Aufnahmegruppen.
  Akzeptiert werden `DJI_YYYYMMDDHHMMSS_NNNN_D.JPG` für RGB
  und `DJI_YYYYMMDDHHMMSS_NNNN_MS_{G,R,RE,NIR}.TIF`.
  Das ist eine **strikte Namenskonvention**, keine zuverlässige
  Verifikation von Sensortyp, DJI-Dateiherkunft oder Aufnahmezeit.
  Andere Varianten bleiben explizit `unrecognized`.
- Zähler für RGB/G/R/RE/NIR, vollständige Vier-Spektral-Sets,
  komplette Fünf-Kanal-Gruppen, partielle Gruppen,
  Doppelbelegungen und fehlende Kanäle.
- `scripts/pi-m3m-media-inventory.js`: explizit angeforderte,
  nichtrekursive **Read-only-Verzeichnisauflistung**.
  Es werden weder Bildinhalte, XMP, EXIF, Nutzdaten, noch
  MinIO-/PostGIS-Objekte gelesen oder geschrieben.
- Das Ergebnis enthält nur Zählwerte und feste Statusbegriffe:
  keine Pfade, Dateinamen, Aufnahmezeiten, GPS-Daten,
  Kameraseriennummern, URLs oder Credentials.

**Wichtig:** `fiveChannelSets>0` beweist **nur Übereinstimmung
der Dateinamenskonventionen**, nicht die tatsächliche
Bildqualität, Bandregistrierung oder Kalibrierung. Die fünf
Analyse-Freigaben bleiben für die gesamte Phase fest auf
`false`: `radiometricCalibrationVerified`,
`bandCoregistrationVerified`, `reflectanceReady`,
`ndviReady`, `ndreReady`.

### Offline auf dem Pi testen

```bash
# Beispiel für einen separaten Git-Worktree, ohne produktiven Checkout:
git -C ~/Projekte/SkyHub-Next fetch origin
git -C ~/Projekte/SkyHub-Next worktree add \
  ~/Projekte/SkyHub-Media-Test \
  origin/feature/m3m-media-inventory-readonly-20261021
cd ~/Projekte/SkyHub-Media-Test
node --test backend/test/m3m-media-inventory.test.js
node scripts/pi-m3m-media-inventory.js --help

# NUR wenn die Bilder bereits lokal auf einer Platte liegen:
node scripts/pi-m3m-media-inventory.js --directory /absoluter/pfad/zu/m3m-bildern
```

Der optionale letzte Befehl greift nur lesend auf die Dateinamen
im genannten Ordner zu. **Nicht** als Verzeichnis das Root eines
Fremdspeichers, ein Backup oder die gesamte MinIO-Datenablage
verwenden. Keine Rekursion, kein Verfolgen von Symlinks,
maximal 20.000 Verzeichniseinträge. Die Existenz konkreter
M3M-Bilddateien auf dem Raspberry Pi ist noch nicht nachgewiesen.

## Noch nicht implementiert / klare Freigabestufen

1. **Phase 2: Gerätespezifische Dateiproben.**
   Originale RGB-/TIF-Dateien anonymisiert in einem
   isolierten Testdatensatz analysieren; tatsächliche M3M-
   Namenskonvention, XMP-/EXIF-Tag-Schema und fünf Bilder
   einer Aufnahme auf Bildinhaltsebene verifizieren.
   Prüfbericht muss Rohwerte/Positionsdaten standardmäßig redigieren.
2. **Phase 3: Speicher und Pilot-2-HTTPS-Upload.**
   MinIO im eigenen Profil kontrolliert bereitstellen,
   S3-STS-/Bucket-/ACL-Konzept festlegen, Fast Upload,
   Tiny Fingerprint, Upload-Callback und Dateiidentität
   gemäß aktueller DJI-Cloud-API implementieren und
   authentifizieren. **Keine dauerhaften Root-Credentials
   an DJI Pilot 2 geben.**
3. **Phase 4: persistenter Asset-Katalog.**
   Erst nach verifiziertem Upload, Objekt-Existenzcheck und
   Metadatenvalidierung die bestehende Tabelle `media_assets`
   migrationssicher erweitern; niemals Upload-Callbacks
   ungeprüft als erfolgte Speicherung behandeln.
4. **Phase 5: Smart-Farming-Auswertung.**
   DN→Reflektanz einschließlich Kamerakalibrierung,
   Sonnenlichtsensor und optionalem Referenzpanel;
   Band-Coregistrierung, Orthomosaik,
   NDVI/NDRE/GNDVI, GIS-Export und Qualitätsprotokoll.
   Die Analysen laufen getrennt vom Pi-MQTT-Backend.

**Keine** MinIO-Starts, Docker-Neustarts, Workflows,
Postgres-Migrationen, DJI-Steuer- oder Upload-Befehle in dieser Phase.
