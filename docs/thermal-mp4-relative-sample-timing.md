# SkyHub-Next – relative MP4-DTS-/PTS-Sample-Tabellen (Offline)

**Status: isolierter Research-Adapter, keine echte Frame-Zeitsynchronisierung.** Die Komponente `backend/workers/thermal_dji_mp4_sample_timing_offline.py` ergänzt den vorhandenen begrenzten MP4/MOV-/SRT-Container-Prüfer aus PR #54. Sie darf ausschließlich auf einer bereits **lokal HMAC-bestätigten, extern manuell gesichteten** Capture-Datei gemäß PR #50 ausgeführt werden. Der zuvor geprüfte signierte Medienbeleg bindet Originalquelle, abgeleitetes Frame und separat angegebene optische Kalibrierung. Alle DJI-Metadaten bleiben ausdrücklich unverifiziert.

## Technischer Leistungsumfang

Der Worker liest nur bereits begrenzte ISO-BMFF-Header-/`moov`-Bytes (maximal 1 MiB `moov`, 128 Top-Level-Atomköpfe sowie 128 Kinder je geprüftem Container). Verarbeitet werden die direkten Strukturpfade
`moov/trak/mdia/mdhd`, `moov/trak/mdia/hdlr` und `moov/trak/mdia/minf/stbl/stts|ctts|stsz`.

- **`mdhd`:** Track-interne Zeitskala in Version 0 oder 1, keine Umrechnung auf echte UTC-Zeit.
- **`hdlr`:** Nur eine einzelne eindeutig ausgezeichnete `vide`-Spur. Zusätzliche reine `soun`-Spuren sind zulässig, mehrere Videospuren sind absichtlich uneindeutig und werden verweigert.
- **`stts`:** Abfolge von Decode-Intervallen (DTS) mit streng validierten ganzzahligen Tick-Differenzen.
- **`ctts`:** Falls vorhanden, Decode-zu-Composition-Offsets für PTS; Version 0 unsigned und Version 1 signed. Negative Composition-Offsets und nicht-monotone PTS werden getrennt vom monotonen DTS gewertet.
- **`stsz`:** Sample-Anzahl und optionale Einzelgrößen dienen ausschließlich einer tabellarischen Konsistenzprüfung. Der Worker verwendet **keine `stco`/`co64`/`stsc`-Offsets, dekodiert keine komprimierten Frames und belegt keinen Bezug zu einzelnen Bytes in `mdat`**. Deswegen heißt die Ausgabe ausdrücklich **`videoSampleTableCountsConsistent=true`**, aber **`videoSamplePayloadMapped=false`**.

Ausgegeben werden nur aggregierte und als *unverified* markierte Größen: `videoTimingSamplesUnverified`, `videoTrackTimescaleUnverified`, `videoDecodeSpanMsUnverified`, `videoCompositionSpanMsUnverified`, `videoCompositionOffsetsPresent` und `videoCompositionOrderDiffersFromDecodeOrder`. Dies sind aus dem Container gelesene, potenziell manipulierte Zeitangaben und keine Bild-/GPS-Messungen.

## Sicherheitsgrenzen / bewusst nicht unterstützt

- Maximal 65.536 Sample-Einträge in ausgedehnter Form und maximal 4.096 RLE-Einträge pro `stts`- oder `ctts`-Tabelle; Grenzen für Zeitskalen, Tick-Differenzen, Samplegrößen und sieben Tage nominelle Dauer.
- Keine `moof`-/`mfra`-Fragmentierung, keine `mvex`-Movie-Extensions, keine `edts`-Edit-Lists, kein `stz2`-Kompaktformat, keine doppelten zwingenden Track-Tabellen und keine leeren/mismatched Samplezahlen.
- Keine Laufzeit-API, kein Netzwerk, keine S3-/MQTT-/DJI-Cloud-Subscription, kein Transcoding, kein ffmpeg-Abhängigkeit, keine neuen Datenbanktabellen und kein aktivierter Pi-Worker.
- Ein optional separat gehashtes SRT kann über die bereits existierende PR-#54-Prüfung strukturell validiert werden. **Sein Zeitbezug zum Video bleibt unbekannt**; selbst identische Dauern ergeben niemals eine Synchronisierungsfreigabe.
- `frameTimestampUtcVerified`, `movieClockUtcVerified`, `telemetryTimebaseVerified`, `videoSampleUtcVerified`, `srtToSampleAlignmentVerified`, `perFramePoseAligned`, `geolocationVerified`, `accuracyMetersVerified`, `flightControlReady` und `searchAndRescueReady` sind **immer false**.
- Keine Bestätigung von DJI-Sensorechtheit, Hardware-Timing, M3T-/M4T-Optikmetrologie oder Personenerkennung.

Ein relativer DTS-/PTS-Samplezeitraum ist **keine** UTC-Aufnahmezeit; es fehlen insbesondere: `edts`-Zeitleistenmapping, gültige Sample-Offset-Ketten zu tatsächlichen Videoframes, Video-Decoding/Frame-Hash, reale Medienaufnahme-/SRT-Herkunft, synchronisierte DJI-Telemetrie-Clock und latenzkompensierte Sensor-/Gimbal-Pose.

## Manuelle Ausführung

```bash
python3 backend/workers/thermal_dji_mp4_sample_timing_offline.py \
  --media /ABSOLUTE/READONLY/externally-reviewed-video.mp4 \
  --image /ABSOLUTE/READONLY/externally-reviewed-8bit-frame.png \
  --registry /ABSOLUTE/PRIVATE/externally-reviewed-registry.json \
  --profile-id EXTERNALLY_VERIFIED_PROFILE_ID \
  --profile-sha256 LOWERCASE_SHA256_OF_APPROVED_PROFILE \
  --capture-envelope /ABSOLUTE/PRIVATE/sealed-capture.json \
  --capture-key-file /ABSOLUTE/PRIVATE/capture-issuer.key \
  --srt /ABSOLUTE/READONLY/independently-pinned.srt \
  --srt-sha256 LOWERCASE_SHA256_OF_INDEPENDENTLY_APPROVED_SRT \
  --output /ABSOLUTE/PRIVATE/new-relative-timing-report.json \
  --accept-reviewed-capture
```

Ohne freigegebenes SRT beide `--srt`-Argumente weglassen. Die Ausgabe erfolgt ausschließlich als neue lokale `0600`-Datei und enthält keine GPS-/SRT-Text-/Kamera-Seriennummer-/Modelldaten. Der vorgeschriebene lokale HMAC-Prüfdatensatz ist weiterhin *privat*; nicht in Git oder Logs hochladen.

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_thermal_dji_mp4_sample_timing_offline.py'
```

Synthetische Container testen DTS/PTS ohne `ctts`, simulierte B-Frame-Reihenfolge, signed Composition-Offsets, v1-`mdhd`, zusätzlichen Audiotrack, mehrere Videospuren, editierte/fragmentierte Medien, doppelte/kaputte Tabellen, widersprüchliche Samplezahlen, private SRT-Texte, HMAC-Manipulation und CLI-Ausgabegates.

Der **nächste Hardware-Meilenstein** ist ein Offline-Fixture-Korpus aus echten, datenschutzkonform geprüften M3T-/M4T-Videodateien samt Recorder-Uhr-/PTS-/SRT-/DJI-Pose-Evidenz und unabhängiger Ground Truth. Ohne diese Angaben erfolgt keine Zuordnung von PTS zu GPS-Koordinaten.
