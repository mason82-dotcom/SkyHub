# SkyHub-Next: DJI JPEG/XMP-Marker nur innerhalb eines signierten Capture-Belegs

**Status: isolierter Offline-Reader, keine DJI-Hardware-Abnahme.** Das Modul \`backend/workers/thermal_dji_jpeg_markers_offline.py\` liest an einem manuell geprüften M3T-/M4T-Medienpaket nur eine **begrenzte JPEG-Headerregion**, um das Vorkommen standardisierter JPEG-APP1-EXIF-/XMP-Einträge und ausgewählter DJI-XMP-*Feldnamen* zu ermitteln. **Es liest keine Werte**, keine GPS-Koordinaten, EXIF-Positionen, Höhen, Kameraserials, Bildpixel, Radiometriedaten und keine Flugzeit. Es öffnet keinerlei DJI-Cloud-Verbindung.

## Bestehende Integritätsbedingungen

1. Der \`skyhub-thermal-source-capture-envelope-v1\`-Beleg aus PR #50 muss mit dem separaten privaten 32-Byte-Capture-Schlüssel verifiziert sein. Die Originaldatei und die separat freigegebene 8-Bit-Einzelbilddatei müssen ihren SHA-256-Werten entsprechen.
2. Das versionierte, **extern freigegebene** Kalibrierungsprofil muss exakt zum separat übergebenen SHA-256-Profilwert passen; Profilnamen ohne geprüften Hash werden nicht akzeptiert.
3. Nur JPG/JPEG kann nach APP1-Markern untersucht werden; MP4/MOV/TIFF wird explizit als \`unsupported-media-format\` gemeldet. Es erfolgt **kein impliziter Fallback** auf Feldwerte aus Pilot-2-Upload-Metadaten.
4. Scanner: höchstens **262.144 Byte**, höchstens **96 JPEG-Segmente**, maximal **32.768 XMP-Bytes**. Nur eine XMP-APP1-Instanz und ein EXIF-APP1-Marker; defekte Längen, Doppelmarker und fehlender Scan-Beginn werden abgewiesen. Es werden weder APP-Daten außerhalb des Scanbudgets, noch komprimierte JPEG-Pixel oder vollständige Dateien in den XMP-Parser eingelesen. Die gesamte Quelldatei wird vor und nachher für den vorhandenen HMAC/Capture-Hash validiert, maximal 512 MiB.
5. Die XMP-Prüfung sucht eine begrenzte RDF-/XMP-Dokumentkennung plus genau den deklarierten \`drone-dji\`-Namespace. Die ausgegebenen \`djiXmpFieldPresence\`-Werte sind ausschließlich boolesche Anwesenheitsindizien. Doppelte Vorkommen desselben Feldnamens führen zu \`false\` für diesen Namen und erhöhen einen festen Ambiguitätszähler. Werteiinhalt, Korrektheit, Schema-Authentizität oder DJI-Sensorherkunft werden **nicht** bestätigt. Auch syntaktisch plausibles XMP könnte gefälscht sein.
6. Ausgabedatei ausschließlich neu/exklusiv (0600), ohne Privatelemente aus dem Original/XMP. Fehler an stdout/stderr enthalten keine Dateinamen/Koordinaten.

## Expliziter Aufruf (nur nach Prüfgate)

\`\`\`bash
python3 backend/workers/thermal_dji_jpeg_markers_offline.py \
  --media /ABSOLUTE/READONLY/externally-reviewed-source.jpg \
  --image /ABSOLUTE/READONLY/externally-reviewed-8bit-frame.png \
  --registry /ABSOLUTE/PRIVATE/externally-reviewed-registry.json \
  --profile-id EXTERNALLY_VERIFIED_PROFILE_ID \
  --profile-sha256 LOWERCASE_SHA256_OF_PINNED_PROFILE \
  --capture-envelope /ABSOLUTE/PRIVATE/new-capture-envelope.json \
  --capture-key-file /ABSOLUTE/PRIVATE/capture-issuer.key \
  --output /ABSOLUTE/PRIVATE/new-redacted-marker-presence.json \
  --accept-reviewed-capture
\`\`\`

Der Capture-Beleg wird zuvor durch \`thermal_capture_calibration_offline.py seal-capture\` generiert; Details: [Thermal capture/calibration](thermal-camera-capture-calibration.md). **Dieser Reader kann keinen Capture-Beleg selbst autorisieren oder die Freigabe-/Kalibrierungsflags erzeugen.**

## Warum Werte bewusst nicht übernommen werden

SkyHub hat schon im Pilot-2-Upload-Vertrag \`absolute_altitude\`, \`relative_altitude\`, \`gimbal_yaw_degree\`, \`shoot_position\` und \`created_time\`. Diese stammen aus einem Upload-Callback. Ihre Bedeutung als **AGL**, *absolute true-north gimbal yaw*, radiometrisch vermessene Kameraoptik oder pro Frame bestätigter UTC-Zeitstempel ist gerade **nicht belegt**.

Der XMP-Leser behauptet deshalb insbesondere **nicht**, dass \`AbsoluteAltitude\` AGL sei, dass \`GimbalYawDegree\` absolute geografische Gimbal-Ausrichtung sei, oder dass \`GPSLatitude\` in Genauigkeit und Aktualität zuverlässig sei. Das Vorhandensein der Bezeichner wird ausschließlich durch \`djiXmpFieldPresence\` protokolliert; \`positionVerified\`, \`timeAlignmentVerified\`, \`altitudeAglVerified\`, \`gimbalPoseVerified\`, \`radiometricCalibrationVerified\`, \`djiSensorOriginVerified\` und \`geolocationVerified\` bleiben **immer false**.

Ein radiometrisches R-JPEG wird dadurch **nicht** zu einem auswertbaren thermischen Messbild. Da keine echten M3T-/M4T-Fixtures zur Verfügung stehen, sind die Namespace-/Feldmarker ein absichtlich schmales Forschungsformat und keine Zusage, dass jedes DJI-Thermalformat erkannt wird.

## Softwaretests

\`\`\`bash
python3 -m unittest discover -s tests -p 'test_thermal_dji_jpeg_markers_offline.py'
\`\`\`

Die Tests verwenden synthetische JPEG-Header mit manipulationsgeschütztem privatem Capture-Beleg. Sie decken Datenschwärzung, fehlende/XMP-fremde Namespace-Marker, doppelte XMP-/EXIF-Marker, doppeltes Feldvorkommen, verstümmelte JPEG-Segmente, Scannerbudget, Quellmanipulation und private Ausgabedateien ab.

**Keine automatisierte Pipeline und keine Kopplung an den produktiven Medienkatalog:** Die nächste sinnvolle Arbeit nach dieser Forschungskomponente ist ein isolierter Adapter, der nur mit *separat* über Workspace/PostgreSQL/HEAD verifizierter DJI-Pilot-Mediendaten-Evidenz arbeitet, passende VersionId/ETag/Hashes durchgehend überprüft, einen authentischen Frame-Zeitbezug herstellt und auch den erforderlichen Datenschutzkontext/Review-Workflow prüft. Eine Übernahme von GPS-Werten oder Flugsteuerungslogik ist bis dahin ausdrücklich untersagt.
