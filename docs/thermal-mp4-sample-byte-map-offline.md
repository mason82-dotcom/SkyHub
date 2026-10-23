# SkyHub-Next – signierter MP4-Sample-Byteindex (Offline-Forschungsmodul)

**Status 2026-10-23:** `backend/workers/thermal_dji_mp4_byte_map_offline.py` ergänzt das in PR #56 eingeführte relative DTS-/PTS-Prüfgate um eine rein **strukturelle Prüfung** von MP4/MOV-Sample-Bytebereichen. Keine produktive Aktivierung, kein DJI-Hardwaretest, kein Frame-Decoding.

## Datenfluss und Vertrauensbasis

Vor jedem Zugriff verifiziert das bereits vorhandene Capture-Gate den privaten HMAC-Beleg, den SHA-256-Hash **der vollständigen MP4/MOV-Originaldatei**, den gesichteten Bild-Derivat-Hash und das **separat freigegebene** Mavic-3T-/Matrice-4T-Kalibrierungsprofil. Danach prüft die vorgelagerte DTS-/PTS-Stufe `mdhd`, `hdlr`, `stts`, `ctts`, `stsz` und optional die separat SHA-256-gepinnte SRT-Zeitstruktur.

Das neue Modul verarbeitet innerhalb der bereits limitierten maximal **1 MiB großen `moov`-Struktur** ausschließlich:

- `stsd`: genau ein ausdrücklich unterstützter, aber **nicht vertrauenswürdig verifizierter** Codec-Label `avc1`, `avc3`, `hvc1` oder `hev1`.
- `stsc`: strikt sortierte Sample-to-Chunk-Gruppen ab Chunk 1, mit passendem Description-Index.
- `stco` **oder** `co64`: genau ein Offset-Tabellentyp; maximal **4096 Chunks**.
- `stsz`: feste oder individuelle Samplegrößen, insgesamt maximal **65.536 Samples** und maximal 64 MiB je Einzelsample.
- Genau ein `mdat`-Atom; es wird nur dessen **Beginn und Ende aus den Containerheadern** gelesen, nicht die Nutzdaten. `stco/co64`-Offsets werden für jede Sample-Gruppe gegen diesen Bereich geprüft.

Jede Chunkgröße muss als Summe der zugeordneten Samplegrößen in `mdat` liegen. Unerwartete Lücken sind bei verschachteltem Video/Audio möglich und werden nicht automatisch als Fehler bewertet; **überlappende oder rückwärts liegende Video-Chunks** werden dagegen verweigert. Bei inkonsistenter Chunk-Anzahl, Tabellenduplikaten, verschlüsselten Samplebeschreibungen, beschädigten Offsets, mehrfachen `mdat`-Atomen, Edit-Listen oder fragmentiertem MP4 erfolgt **fail-closed**.

Nach dem Parsen wird der komplette Originalmedien-SHA-256 erneut geprüft; mutable Dateien zwischen diesen Prüfungen bleiben ein TOCTOU-Risiko und gehören auf unveränderlichen, geschützten Offline-Speicher.

## Exakte Aussagen der Ausgabe

Das Ergebnis meldet ausschließlich **summarische**, unbestätigte Containerwerte:

| Feld | Bedeutung |
|---|---|
| `videoIndexedSamplesUnverified` | Tabellenbasierte Samplezahl |
| `videoIndexedChunksUnverified` | Tabellenbasierte Chunkzahl |
| `videoIndexedPayloadBytesUnverified` | Summe der in den Tabellen behaupteten Videodaten-Bytebereiche |
| `videoChunkOffsetWidthBits` | Strukturtyp 32-/64-Bit-Chunkoffsets |
| `videoCodecLabelUnverified` | Als H264/H265 markierter *Containerhinweis*, keine Codec-Validierung |
| `videoSampleByteRangesStructurallyMapped` | Einträge liegen laut gültiger Offset-/Größentabellen innerhalb des gehashten `mdat` |
| `srtVsVideoDecodeSpanDifferenceMsUnverified` | Optional bloße Differenz zwischen SRT-Cue-**Span** und DTS-**Span**; kein gemeinsamer Nullpunkt und keine Synchronisationsfreigabe |

**Immer false:** `videoEncodedSampleBytesDecoded`, `videoSamplePayloadAuthenticityVerified`, `videoFrameDecodeVerified`, `videoSampleUtcVerified`, `srtToSampleAlignmentVerified`, `perFramePoseAligned`, `frameTimestampUtcVerified`, `geolocationVerified`, `accuracyMetersVerified`, `flightControlReady` und `searchAndRescueReady`.

Keine exakten Chunk-Offsets, Sample-IDs, PTS-/DTS-Einzelwerte, Kameraseriennummern, SRT-Texte, Ortsdaten oder privaten HMAC-Werte verlassen den Worker. Die strukturell zugeordneten Bereiche sind **nicht** an einen tatsächlich dekodierten Einzelbildhash gebunden; die Beziehung zwischen DJI-Originalvideo und dem gesonderten Analysebild wird weiterhin nur durch den vorherigen manuellen Review behauptet.

## Expliziter privater Offline-Aufruf

```bash
python3 backend/workers/thermal_dji_mp4_byte_map_offline.py \
  --media /ABSOLUTE/READONLY/externally-reviewed-source.mp4 \
  --image /ABSOLUTE/READONLY/reviewed-derived-frame.png \
  --registry /ABSOLUTE/PRIVATE/pinned-camera-registry.json \
  --profile-id EXTERNALLY_VERIFIED_PROFILE_ID \
  --profile-sha256 LOWERCASE_SHA256_OF_APPROVED_PROFILE \
  --capture-envelope /ABSOLUTE/PRIVATE/signed-capture.json \
  --capture-key-file /ABSOLUTE/PRIVATE/capture-issuer.key \
  --srt /ABSOLUTE/READONLY/independently-pinned-sidecar.srt \
  --srt-sha256 LOWERCASE_SHA256_OF_APPROVED_SRT \
  --output /ABSOLUTE/PRIVATE/new-byte-map-summary.json \
  --accept-reviewed-capture
```

Die zwei optionalen SRT-Argumente sind gemeinsam anzugeben oder gemeinsam wegzulassen. Alle Pfade sind absolute lokale Pfade; das Ergebnis wird nur in einer neuen exklusiv angelegten Datei (0600) gespeichert. Es gibt keine Schreiboperationen an Video/SRT, keine API-Anbindung und keine neuen produktiven Komponenten.

## Tests / verbleibende Hardwareabnahme

```bash
python3 -m unittest discover -s tests -p 'test_thermal_dji_mp4_byte_map_offline.py'
```

Die Tests verwenden ausschließlich selbst konstruierte MP4-Container und prüfen 32-/64-Bit-Offets, feste und variable Samplegrößen, nicht übereinstimmende Chunk-/Samplezähler, fehlerhafte `stsc`-Reihenfolgen, `mdat`-Out-of-Bounds, Überlappungen, ungültige Codecbeschreibungen, Manipulationen nach dem Signieren, SRT-Dauerabweichungen sowie den Datenschutz der CLI-Ausgabe.

Der nächste Schritt für echte DJI-M3T-/M4T-Medien ist ein durch unabhängige Stichproben geprüftes **Codec-Decoding mit verifizierter Sample-Byte-zu-Frame-Zuordnung und Framehash**, darauf aufbauend SRT-Clock-Anker, tatsächliche DJI-Telemetrie-Synchronisierung, Kalibrierungs-/Georeferenzierungs-Ground-Truth. Bis dahin bleiben Ortung und SAR-/Flugfreigaben gesperrt.
