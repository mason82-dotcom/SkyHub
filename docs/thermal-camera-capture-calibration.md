# SkyHub-Next: Mavic 3T / Matrice 4T Thermal-Kalibrierung und DJI-Medienherkunft

**Implementierungsstatus: offline research only / fail-closed.** Stand: 2026-10-23. Kein Kamera-/Objektivwert ist werkseitig eingetragen, keine DJI-Hardware wurde zur Messwertvalidierung benutzt. Es existiert **keine kryptografische Bestätigung durch DJI** und keine automatische SRT/XMP-Verarbeitung.

Die neue Schnittstelle \`backend/workers/thermal_capture_calibration_offline.py\` ist ein separater, lokal ausgeführter Vertrauens-/Integritäts-Gate. Sie verbindet:
1. Extern überprüftes **Kalibrierungsprofil**, versioniert mit \`revision\`, eindeutig benannt mit \`profileId\` und separat fixiertem SHA-256-Wert über kanonisches JSON.
2. Physische Bytes einer manuell gesichteten Original-Mediendatei (JPG/JPEG/MP4/MOV/TIF/TIFF, maximal 512 MiB).
3. Physische Bytes eines separat gesichteten und optisch unverändert auf den kalibrierten Vollbild-Pixelraum abgebildeten 8-Bit-JPG-/PNG-Einzelbilds (maximal 30 MiB).
4. Einen *eigenen* 32-Byte-HMAC-Schlüssel für die lokale Medienfreigabe und einen anderen, separaten Schlüssel für die zuvor in PR #49 signierte Modell-/Detektions-/Pose-Auswertung.
5. Das exakt gleiche Bild, eine exakt gleiche Framezeit, Modell-Gewichtshash und dasselbe Kameraprofil in der abschließenden Geo-Projektion.

## Registry-Format

Nur \`Mavic 3T\` und \`Matrice 4T\` sind als Profiltags zugelassen. Das legt **keinerlei reale Optikwerte** fest, ist keine Hardwareerkennung und kein Nachweis der angegebenen DJI-Modellidentität. Verwende ausschließlich extern vermessene und freigegebene Profile. Ein vollständiger Registry-Datensatz hat dieses Format:

\`\`\`json
{
  "schema": "skyhub-thermal-camera-calibration-registry-v1",
  "profiles": [
    {
      "profileId": "SYNTHETIC_RESEARCH_ONLY",
      "revision": 1,
      "aircraftModel": "Matrice 4T",
      "sensor": "thermal",
      "frame": {
        "width": 640,
        "height": 512,
        "coordinateSpace": "undistorted_uncropped"
      },
      "camera": {
        "calibrationId": "SYNTHETIC_RESEARCH_ONLY",
        "horizontalFovDeg": 50,
        "verticalFovDeg": 40,
        "verified": true,
        "zoomRatio": 1
      },
      "evidence": {
        "kind": "independent-offline-camera-calibration",
        "evidenceSha256": "REPLACE_WITH_64_LOWERCASE_HEX",
        "reviewId": "SYNTHETIC_REVIEW_01",
        "calibrationExternallyReviewed": true
      }
    }
  ]
}
\`\`\`

**Alle Zahlen im Beispiel sind synthetische Testdaten, keine M4T-/M3T-Spezifikationen oder Kalibrierungen.** Das Beispiel ist wegen seines absichtlich ungültigen Evidenz-Hashs nicht ausführbar. \`verified\` und \`calibrationExternallyReviewed\` sind menschliche Behauptungen des Herausgebers; der Code kann keine Messprotokolle oder Identitäten verifizieren. \`evidenceSha256\` muss den freigegebenen unabhängigen Kalibrierungsbericht (privat archiviert) adressieren. \`reviewId\` darf keine personenbezogenen Namen/Seriennummern enthalten.

Die *vollständige* Profilstruktur, nicht bloß die FOV-Werte, wird kanonisch mit
\`json.dumps(profile, sort_keys=True, ensure_ascii=True, allow_nan=False, separators=(",", ":"))\`
und SHA-256 gebunden. Der erwartete \`--profile-sha256\` muss aus einer **separat** freigegebenen, nicht zusammen mit dem Registry-File änderbaren Quelle stammen. Das Registry-File allein ist keine Autorität.

Es gibt bewusst weder einen automatischen Default noch ein produktives, voreingestelltes Profil. Im regulären SkyHub-Betrieb bleibt diese Funktion ausgeschaltet.

## Capture-Review als lokales Sidecar

Bei Erstellung eines lokalen Aufnahmebelegs ist eine private JSON-Datei erforderlich, deren vollständige Struktur wie folgt lautet:

\`\`\`json
{
  "aircraftModel": "Matrice 4T",
  "frameTimestampMs": 1800000000000,
  "sourceMediaReviewed": true,
  "frameDerivationReviewed": true,
  "pixelMappingReviewed": true
}
\`\`\`

Diese fünf Angaben müssen **vor der Bescheinigung durch einen unabhängigen Offline-Prüfprozess** festgelegt werden. Die \`frameTimestampMs\` müssen derselben verifizierten UTC-Zeitbasis wie das bereits freigegebene Detektions-/Telemetrie-Review entsprechen. Frame und Quelle müssen getrennte reguläre Dateien sein, auch Hardlinks sind unzulässig. Originalmedium und gerendertes Frame werden als **opaque Bytes** behandelt: Der Worker interpretiert keine DJI-XMP, Rohthermaldaten, SRT-Frames, Kamera-IDs oder Videotimestamps. \`frameDerivationReviewed\` belegt deshalb nur die durch Menschen behauptete/extern dokumentierte Beziehung.

Ein \`identity-undistorted-full-frame\`-Mapping ist Pflicht im separat geprüften Geolocation-Review; nicht korrigierte, zugeschnittene oder letterbox-resizete Framekoordinaten dürfen nicht durch ein gesetztes Flag künstlich aufgewertet werden.

## Offline-Ausführung

Zwei eigene Schlüsseldateien, beide separat und privat aufbewahrt, sind nötig. Beide müssen reguläre Dateien mit exakt 32 Rohbytes sein, dem ausführenden Nutzer gehören und mindestens Modus 0600 haben (keine Rechte für Gruppe/Andere).

\`\`\`bash
umask 077
head -c 32 /dev/urandom > /ABSOLUTE/PRIVATE/capture-issuer.key
head -c 32 /dev/urandom > /ABSOLUTE/PRIVATE/detector-issuer.key
chmod 600 /ABSOLUTE/PRIVATE/capture-issuer.key /ABSOLUTE/PRIVATE/detector-issuer.key

# 1. Capture-Beleg erstellen – keine Detektion, kein GPS.
python3 backend/workers/thermal_capture_calibration_offline.py seal-capture \
  --media /ABSOLUTE/READONLY/dji-original.jpg \
  --image /ABSOLUTE/READONLY/externally-reviewed-frame.png \
  --registry /ABSOLUTE/PRIVATE/externally-reviewed-registry.json \
  --profile-id EXTERNALLY_VERIFIED_PROFILE_ID \
  --profile-sha256 LOWERCASE_SHA256_OF_PINNED_PROFILE \
  --capture-key-file /ABSOLUTE/PRIVATE/capture-issuer.key \
  --capture-review /ABSOLUTE/PRIVATE/capture-review.json \
  --output /ABSOLUTE/PRIVATE/new-capture-envelope.json \
  --accept-reviewed-capture --allow-sensitive-location-output

# 2. Bereits separat mit PR #49 erzeugtes, privates Detektor-Envelope
#    und das lokale Capture-Envelope gemeinsam prüfen.
python3 backend/workers/thermal_capture_calibration_offline.py verify \
  --media /ABSOLUTE/READONLY/dji-original.jpg \
  --image /ABSOLUTE/READONLY/externally-reviewed-frame.png \
  --model /ABSOLUTE/READONLY/externally-reviewed-thermal-person.onnx \
  --model-sha256 LOWERCASE_SHA256_OF_REVIEWED_WEIGHTS \
  --registry /ABSOLUTE/PRIVATE/externally-reviewed-registry.json \
  --profile-id EXTERNALLY_VERIFIED_PROFILE_ID \
  --profile-sha256 LOWERCASE_SHA256_OF_PINNED_PROFILE \
  --capture-envelope /ABSOLUTE/PRIVATE/new-capture-envelope.json \
  --detection-envelope /ABSOLUTE/PRIVATE/sealed-detection-envelope.json \
  --capture-key-file /ABSOLUTE/PRIVATE/capture-issuer.key \
  --detection-key-file /ABSOLUTE/PRIVATE/detector-issuer.key \
  --output /ABSOLUTE/PRIVATE/new-unverified-gps-candidates.json \
  --accept-reviewed-capture --allow-sensitive-location-output
\`\`\`

Vorher: PR-#49-Detektor-/Review-Envelope mit dem zweiten Schlüssel signieren; dabei exakt dieselbe Bilddatei und denselben Zeitstempel wie beim Capture-Review verwenden. Die separate \`--profile-sha256\`-Vorgabe muss den **kanonischen Profil-Hash**, nicht den SHA-256 des gesamten Registry-Dokuments, enthalten.

Alle Eingabe-/Ausgabedateien müssen **lokal und absolut** referenziert sein. Symlinks werden für die geprüften Datenfile-Endpunkte abgelehnt. Der JSON-Reader begrenzt Dateigröße, prüft JSON-Duplikate; Outputs werden nur exklusiv mit Modus 0600 angelegt. Die CLI schreibt keine Koordinaten, Schlüssel oder Medieninhalte nach stdout. Beleg-/Review-Dateien enthalten sensible zeit- und ortsbezogene Daten; keinesfalls in Git, CI-Logs oder Browser überführen.

## Exakte Prüfaussagen

Im Endergebnis sind **alle drei lokalen Bindungen** bestätigt:
- \`captureEnvelopeIntegrityVerified=true\`: HMAC des Capture-/Profil-/Bild-/Quellen-Belegs passt zum privaten Capture-Schlüssel.
- \`detectionEnvelopeIntegrityVerified=true\`: HMAC der vorherigen Detektor-/Pose-/Modell-Pipeline passt zum unabhängigen Detektionsschlüssel.
- \`calibrationProfileDigestVerified=true\`: Vollständiges Kameraprofil passt zum separat freigegebenen SHA-256 und zum signierten Detektor-Review.
- Zusätzlich entsprechen Originalmedium und abgeleitetes Bild den beim Signieren festgelegten SHA-256-Hashes; beide Review-Zeitstempel sind exakt identisch.

**Immer false** bleiben \`djiSensorOriginVerified\`, \`thermalRadiometryVerified\`, \`calibrationGroundTruthVerified\`, \`geolocationVerified\`, \`accuracyMetersVerified\`, \`personPresenceVerified\`, \`trackingVerified\`, \`flightControlReady\` und \`searchAndRescueReady\`. Die Validität des lokalen HMACs ist kein Authentizitätsnachweis einer DJI-Hardwareaufnahme, kein Bild-Fingerprint einer signierten Kamera und kein Beleg einer optischen Metrologie. Der tatsächliche Geolocation-Fehler (Meter) ist nicht bestimmt.

**Verbleibende Risiken:** Selbst signierte/böswillig veränderte Review-Freigaben, gestohlene Schlüssel, falsche Source-to-Frame-Zuordnung, mutable Dateien/TOCTOU und kompromittierte lokale Workstation. Für höhere Vertrauensstufen wären separate Capture-Authorität/Hardware-Signaturen, sensorverifizierte Metadaten, unveränderliches Storage sowie vermessene Kameraextrinsik und Ground Truth nötig. Kein Live-UAV-Alarm und keine Sicherheits-/SAR-Automatisierung vor diesen Messungen.

## Tests

\`\`\`bash
python3 -m unittest discover -s tests -p 'test_thermal_capture_calibration_offline.py'
\`\`\`

CI verwendet synthetische Dateien, Mock-Modelle und keine DJI-Hardware. Testfälle decken unter anderem veränderte Source-/Bildbytes, falsche Modell-/Profilversion, manipulierte FOV-Werte, falsche Zeitstempel, HMAC-Austausch, Nichtidentität der Schlüssel, fehlende Review-Flags, Hardlinks und privates CLI-Verhalten ab.
