# SkyHub Next – kontrollierte M3M-TIFF-/XMP-Werteauslesung

Stand: 22. Oktober 2026. Separater Draft-Branch auf PR #39. **Keine aktive HTTP-Route, kein Worker, kein Deployment, keine Pi-MinIO-Zugriffe.**

## Ausgangslage

Die vorhandenen SkyHub-Module `m3m-tiff-ifd.js`, `m3m-xmp-markers.js`, `m3m-xmp-capture-groups.js`, `m3m-media-inventory.js` werden **wiederverwendet**. Sie liefern bewusst nur Aggregatzähler und haben bislang niemals private XMP-CaptureUUIDs oder GPS-Koordinaten außerhalb ihrer isolierten Probe ausgegeben. Der neue Probe-Service akzeptiert nur Medien, die zuvor über `dji_pilot_media_verified` unter einem registrierten STS-Workspace-Pfad und mit HeadObject-Evidenz gespeichert wurden.

DJI-Dokumentation: Mavic 3M Image Processing Guide (2023): https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20230829/Mavic_3M_Image_Processing_Guide_EN.pdf . Die Dokumentation listet BlackCurrent, SensorGain, SensorGainAdjustment, Irradiance, ExposureTime, IrradianceExposureTime, IrradianceGain, SensorIndex, BandName, ImageSource, CentralWavelength, CaptureUUID und GPS-/RTK-Tags. Sie beschreibt NDVI erst **nach** der radiometrischen Korrektur und Band-Ausrichtung.

## Code und Geltungsbereich

`backend/m3m-xmp-safe-values.js` akzeptiert maximal 32.768 Byte DJI-XMP und emittiert ausschließlich folgende Whitelist-Felder, falls numerisch plausibel und eindeutig vorhanden:

- `BlackCurrent` (0–65.535), `SensorGain` (0,000001–10.000), `SensorGainAdjustment` (0,000001–10.000)
- `Irradiance` (0–100.000.000), `IrradianceExposureTime` (0,000001–3600), `IrradianceGain` (0,000001–1.000.000), `ExposureTime` (0,000001–3600)
- `CentralWavelength` (350–1100), `SensorIndex` (1–4, ganzzahlig)
- `BandName`/`ImageSource` nach **bestehendem** restriktivem Band-Enum G, R, RE, NIR; `GpsStatus` nur als enumerierter, explizit **unverifizierter** RTK-Metadatenhinweis (`Normal` / `RTK` / `Invalid` / `unknown`).

Der Reader emittiert **keine** tatsächliche GPS-Position, Kameraseriennummer, Drohnenseriennummer, Bildrohdaten, Freitexte oder CaptureUUID. Fehlende, doppelte oder ungültige numerische Angaben werden nicht als Messwerte übernommen. Diese Konfidenzgrenzen sind einfache Plausibilitätsregeln, **keine** DJI-Kalibrierungsprüfung.

`backend/m3m-verified-xmp-probe.js` stellt `createVerifiedM3mXmpProbe({db,s3,headObject})` bereit. Es gibt `single({workspace,id})` und `group({workspace,groupId})` zurück. Beide Schnittstellen sind **nur intern**, nicht aus `server.js` oder dem UI erreichbar.

### Datenzugriff: exakt begrenzt

1. PostgreSQL-Query per Workspace-UUID und interner Asset-UUID; nur bereits verifizierte TIFF-Dateien mit passendem DJI-M3M-Dateinamen.
2. Frische serverseitige `HeadObject`-Prüfung der **exakt gespeicherten** Dateigröße, ETag und LastModified.
3. Maximal drei `GetObjectCommand`-Abrufe mit `Range`, `IfMatch` und explizitem Abort-Timeout pro Bild: Header (16 Byte), TIFF-Verzeichnis (bis 1024 Byte) und durch TIFF-Tag 700 begrenztes XMP (bis 32.768 Byte). Gesamtlimit **33.808 angeforderte Byte pro Objekt**, nicht ein ungebremster TIFF-Download.
4. Nur HTTP 206 mit korrekter Content-Range-Gesamtgröße, ETag, Content-Length und exakt gelieferter Byteanzahl gilt als gültig. HTTP 200 trotz Range, ETag-Wechsel, unterlaufene/überlange Antworten und defekte TIFF-Pointer werden nicht akzeptiert.
5. Keine S3-List-, Put-, Delete- oder Presigned-URL-Aktion. Die S3-Client-Identität ist extern als leseberechtigte, workspace-seitig begrenzte Identität bereitzustellen. Der existierende Put-only-Pilot-STS-Token ist hierfür ausdrücklich ungeeignet.

### Gruppen und vertrauliche XMP-Daten

Die Gruppenprobe ist auf **12 verifizierte TIFF-Dateien** begrenzt, maximal 36 gezielte Range-GETs, insgesamt bis zu 405.696 angeforderte Byte. Nur im Arbeitsspeicher wird die bereits existierende `captureUuidFromXmp`-Funktion zum Gruppieren verwendet. Das Ergebnis basiert auf `summarizeCaptureGroups` und enthält nur feste Zähler sowie die expliziten Flags `m3mSourceVerified:false`, `bandCoregistrationVerified:false`, `radiometricCalibrationVerified:false`, `reflectanceReady:false`, `ndviReady:false` und `ndreReady:false`.

**Wichtig:** Gleiche CaptureUUID und vier unterschiedliche XMP-Bandmarker bilden nur einen Bildgruppenhinweis. Daraus ergibt sich ohne geometrische und radiometrische Korrektur keine NDVI-/NDRE-fähige Verarbeitung.

## Sicherheits-/Produktionsgrenzen

- **Kein** Lesen produktiver Bilder wurde durchgeführt. Keine Migration, API-Aktivierung, Tokenänderung, Containeränderung oder Datenbank-Schreiboperation am Pi.
- Dieser Entwicklungsstand ersetzt **nicht** einen vollständigen EXIF-/GPS-/RTK-Qualitäts-Extractor oder eine radiometrische Berechnung. Der RTK-Status ist ein unbestätigtes Textfeld aus dem XMP; Koordinatengenauigkeit und RTK-Fix werden daraus nicht bewiesen.
- XMP liegt nur zeitweilig im Node-Prozessspeicher. Anders als die alte per Docker-`exec` isolierte Aggregatprobe ist die neue Node-Komponente noch **keine separate Prozess-/Container-Sandbox**. Für die Produktivfreigabe sind Speicherseparation, Ausführungskontext, Timeouts, eine identitätsgebundene Read-Policy und spezifische Datenschutztests weiterhin notwendig.
- Die Integrität wird mit S3-ETag und `IfMatch` abgesichert, aber **nicht** mit einem vollständigen SHA256 und nicht über versioniertes S3-`VersionId`. Auch korrektes S3-HEAD schützt nicht vor manipulierten Bildinhalten.
- Hardwareabnahme mit tatsächlichen RC-Pro-Enterprise-/Mavic-3M-Dateien muss gesondert erfolgen; vorhandene frühere Hardwaretests werden damit nicht infrage gestellt.
