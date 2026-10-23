# SkyHub-Next – Begrenzte DJI MP4/MOV-/SRT-Zeitstrukturprüfung

**Status: Offline-Forschung, keine Hardwareverifikation.** `backend/workers/thermal_dji_video_timebase_offline.py` untersucht lokal abgelegte, bereits mit PR #50 HMAC-/SHA-256-bestätigte Quellen. Der Prüfpfad ist unabhängig von SkyHub-Backend, DJI Cloud API, RTSP, MQTT, ROS2, Datenbank, MinIO und Flugsteuerung. Es werden weder Videos dekodiert noch Geokoordinaten, private SRT-Payloads, Kalibrierungsdaten oder Kamera-IDs ausgegeben.

## Zulässige Quelle und Metadaten

- Die **vollständige Quell-MP4/MOV-Datei** wird über `thermal_capture_calibration_offline.verify_capture()` samt getrennt geprüfter Frame-Ableitung, HMAC und unabhängigem SHA-256-Kameraprofil validiert. Vor Abschluss wird die Quell-Datei erneut gehasht (bis zur bestehenden 512-MiB-Quellgrenze).
- MP4/MOV: sparsames Lesen der ISO-BMFF-/QuickTime-*Atomheader*. Zulässig sind maximal **128 Top-Level-Atome**, ein `ftyp`-Atom am Anfang und maximal **1 MiB** Nutzdaten aus genau einem `moov`-Atom. `mdat`-Bild-/Videodaten werden **übersprungen**, nicht gelesen. Die Schachtelung in `moov` ist bewusst auf die unmittelbaren Child-Atome begrenzt.
- `mvhd`-Fullbox in Version 0 oder 1: aus der angegebenen Zeitskala und Duration wird höchstens eine `movieNominalDurationMsUnverified` berechnet (max. 7 Tage); dazu kommt die Anzahl der direkten `trak`-Atome. Nicht unterstützt: Fragmente/fehlende `moov`-/`mvhd`-Blöcke, keine `ftyp`-Box, atypische QuickTime-Strukturen oder unplausible Zeitskalen. **Nicht** extrahiert werden Creation/Modification Dates aus der MP4, Frame-PTS/DTS, RTK, Bildzeiten oder DJI-Privat-Tags.
- Nicht-MP4/MOV-Dateien melden `unsupported-media-format`. Dies ist kein R-JPEG-/TIFF-/Videodecoder und keine automatische Erkennung eines physischen DJI-Geräts.

## Optionales SRT-Sidecar

SRT-Inhalte sind unter Umständen orts- oder personenbezogen. Der Worker akzeptiert sie nur bei **beiden** expliziten Parametern `--srt` und `--srt-sha256`. Der erwartete Kleinschreibungs-SHA-256 muss aus einer unabhängigen, extern freigegebenen Quelle stammen. Der Sidecar-Pfad muss absolut und lokal, die Endung `.srt` sein, kein Symlink; bis zu **128 KiB**, **512 Untertitel-Cues** und **4096 Zeilen**.

Erlaubt sind ausschließlich streng aufsteigend nummerierte Blöcke mit gültiger `HH:MM:SS,mmm --> HH:MM:SS,mmm`-Zeitspanne, ohne Überlappungen. Ausgegeben werden nur `srtCueCount`, `srtRelativeSpanMsUnverified`, `srtCueTimecodesMonotonic` und `srtPinnedBytesVerified`; der gesamte SRT-Text, DJI-Werte, GPS, Personennamen oder Seriennummern bleiben privat. Vor und nach dem Parsing wird der vollständige SHA-256 neu geprüft.

**Wichtig:** Ein extern gepinnter SRT-Hash garantiert nicht, dass das SRT ursprünglich von DJI stammt oder tatsächlich mit dieser MP4-Datei aufgezeichnet wurde. Der bestehende Capture-HMAC in PR #50 umfasst diese Sidecar-Datei **nicht**. Für produktive Frame-Zeitzuordnung ist eine eigenständige extern authentisierte Zuordnung zwischen MP4, SRT, Frame-PTS, UTC-Zeitquelle und Pose-Telemetrie erforderlich.

## CLI (explizites Offline-Gate)

```bash
python3 backend/workers/thermal_dji_video_timebase_offline.py \
  --media /ABSOLUTE/READONLY/externally-reviewed-source.mp4 \
  --image /ABSOLUTE/READONLY/externally-reviewed-frame.png \
  --registry /ABSOLUTE/PRIVATE/externally-reviewed-registry.json \
  --profile-id EXTERNALLY_VERIFIED_PROFILE_ID \
  --profile-sha256 LOWERCASE_SHA256_OF_APPROVED_PROFILE \
  --capture-envelope /ABSOLUTE/PRIVATE/sealed-capture.json \
  --capture-key-file /ABSOLUTE/PRIVATE/capture-issuer.key \
  --srt /ABSOLUTE/READONLY/externally-pinned-sidecar.srt \
  --srt-sha256 LOWERCASE_SHA256_OF_INDEPENDENTLY_APPROVED_SRT \
  --output /ABSOLUTE/PRIVATE/new-redacted-timebase-report.json \
  --accept-reviewed-capture
```

Wird kein separat gepinntes SRT verwendet, beide `--srt`-Parameter weglassen. Ein Report entsteht nur an einem **neuen exklusiven lokalen Output-Pfad** (0600); es werden keine Dateien überschrieben und keine sensiblen Daten in die Logs geschrieben.

## Fehlende Trust-Gates

`movieClockUtcVerified`, `srtVideoAlignmentVerified`, `frameTimestampUtcVerified`, `telemetryTimebaseVerified`, `djiSensorOriginVerified`, `positionVerified`, `altitudeAglVerified`, `gimbalPoseVerified`, `geolocationVerified`, `accuracyMetersVerified`, `flightControlReady`, `searchAndRescueReady` sind **immer false**. Die nominelle MP4-Dauer und die relative Cue-Dauer sind nur unbestätigte Strukturwerte.

Tests: `python3 -m unittest discover -s tests -p 'test_thermal_dji_video_timebase_offline.py'`. Sie verwenden synthetische MP4/MOV-Atome, private, mock-signierte Capture-Profile und frei erfundene SRT-Daten; **keine** Matrice-4T-/Mavic-3T-Aufnahme, DJI-Video-/Pose-API, Hardware-Synchronisierung oder SAR-Messung wurde geprüft.
