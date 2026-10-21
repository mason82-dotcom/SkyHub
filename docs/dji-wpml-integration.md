# DJI WPML / KMZ – SkyHub Next (21.10.2026)

## Offizielle Referenz (Cloud API 1.18)

- Overview: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/overview.html
- Template.kml: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/template-kml.html
- Waylines.wpml: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/waylines-wpml.html
- Common Elements: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/common-element.html
- Product Support: https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-support.html

DJI WPML ist ein DATEIFORMAT, keine Flugsteuerungs-API. Im KMZ-Archiv liegen
wpmz/template.kml (editierbare Vorlage), wpmz/waylines.wpml (ausführbarer
Flugweg) und optional wpmz/res/ (Ressourcen). Ein mapping3d-Template
generiert gewöhnlich fünf ausführbare Wayline-Folder. Eine Mappingvorlage
darf nicht mit einer fertig berechneten und flugfähigen Route verwechselt
werden.

## Integration im neuen Feature-Branch

- backend/wpml.js: Offline-XML-Parser ohne DTD oder externe Entitäten,
  strukturelle Prüfung von MissionConfig, Geschwindigkeiten, Höhensystemen,
  WPML-Enumwerten, Waypoints, Koordinaten, Ordner-IDs, Heading/POI,
  Kurven und ausgewählten Kameraaktionen.
- backend/wpml-product-support.js: DJI-Aircraft/Payload-Profile mit
  Mavic 3E/3T/3M, Matrice 4E/4T, M30/M30T, M3D/M3TD und M4D/M4TD.
  Controller-Codes gehören NICHT in droneEnumValue.
- backend/wpml-kmz.js: ZIP/KMZ-Import (Store/Deflate), sicherer ZIP-Parser
  mit CRC32-, Pfad-, Größen-, Duplikat-, ZIP64- und Symlink-Prüfung;
  Export bereits vollständiger WPML-Dokumentpaare unter wpmz/.
  Ressourcen werden nicht ausgeführt, entschlüsselt oder zurückgeliefert.
- scripts/wpml-inspect.js: Offline-Kommando zum Inspizieren und Verpacken.
- POST /api/wpml/inspect: Optionaler, authentifizierter Binärupload, liefert
  nur ein JSON-Prüfergebnis. Nur aktiv bei SKYHUB_WPML_INSPECT_ENABLED=true;
  standardmäßig inaktiv. HTTP 200 bei validierter Datei, 422 bei
  Fehlern, keine Rohdaten in generischen Archivfehlern.
- backend/test/wpml.test.js: Roundtrip-, Negativ- und Sicherheitsfälle.

### Lokale Nutzung

    node scripts/wpml-inspect.js mission.kmz
    node scripts/wpml-inspect.js --pack template.kml waylines.wpml out.kmz

Der zweite Befehl berechnet KEINEN Flugweg und überschreibt keine Datei.

## DJI Fluggerät-/Payload-Matrix

| Modell | droneEnumValue | droneSubEnumValue | payloadEnumValue |
| --- | ---: | ---: | ---: |
| Mavic 3E | 77 | 0 | 66 |
| Mavic 3T | 77 | 1 | 67 |
| Mavic 3M | 77 | 2 | 68 |
| Mavic 3TA | 77 | 3 | 129 |
| Matrice 4E | 99 | 0 | 88 |
| Matrice 4T | 99 | 1 | 89 |
| Matrice 30 | 67 | 0 | 52 |
| Matrice 30T | 67 | 1 | 53 |
| Matrice 3D | 91 | 0 | 80 |
| Matrice 3TD | 91 | 1 | 81 |
| Matrice 4D | 100 | 0 | 98 |
| Matrice 4TD | 100 | 1 | 99 |

Gilt für feste Hauptkamera am gimbalindex 0. Mavic 3M Typ 77/2 und Kamera
68 basieren auf der DJI-WPML-Tabelle, die allgemeinere aktuelle
Produkt-Support-Tabelle führt M3M teils nicht separat; Pilot-2-KMZ prüfen.

## Feldabgleich: WPML-Unterseiten

| Bereich | Referenzfelder/Mechanismen | Code-Abdeckung |
| --- | --- | --- |
| Archiv | wpmz-Verzeichnis, XML-WPML-Namespace 1.0.2, ZIP/KMZ | Ein-/Auslesen, Grenzen |
| MissionConfig | flyToWaylineMode, finishAction, exitOnRCLost, executeRCLostAction, takeOffSecurityHeight, globalTransitionalSpeed | Pflicht-/Enum-/Werteprüfung |
| Produkte | droneInfo, payloadInfo, subtype, gimbalindex, autoRerouteInfo | Typ-/Payloadabgleich |
| Templates | waypoint, mapping2d, mapping3d, mappingStrip, templateId, waylineCoordinateSysParam | Teilvalidierung |
| Vermessung | Polygon, LinearRing, LineString, overlap, direction, shootType, smartOblique, mappingHeadingParam, imageFormat | Geometrie; Flugwegberechnung OFFEN |
| Waylines | Folder, waylineId, templateId, executeHeightMode, autoFlightSpeed, Placemark, executeHeight, waypointSpeed | Pflicht-/ID-/Werteprüfung |
| Kurven/Heading | Heading modes, POI, waypointTurnMode, dampingDist, useStraightLine | Teilvalidierung |
| Aktionen | actionGroup, startActionGroup, Ids, Trigger, reachPoint, multipleTiming, multipleDistance | Gruppen-/Teilparameterprüfung |
| Kameras | takePhoto, startRecord, stopRecord, focus, zoom, gimbalRotate, rotateYaw, hover, orientedShoot | Teilparameterprüfung |
| Spezial | accurateShoot, panoShot, searchlight, LiDAR/recordPointCloud, AI Spot-Check | Nicht vollständig geprüft |
| Höhen | WGS84, EGM96, relativeToStartPoint, AGL, realTimeFollowSurface | Enum-Prüfung; Umrechnung OFFEN |

## Betriebsschutz und Grenzen

Keine Flugbefehlserzeugung, kein MQTT-Publish, keine Kopplung an den
Missionsversand, keine Datenbankmigration, keine Speicherung von Uploads,
keine Aktivierung der Missionsroute. POST /api/mission/create antwortet
weiterhin mit HTTP 501. Der Pi und seine Docker-Dienste bleiben unberührt.

Dies ist ausdrücklich ein ERSTER offline-fähiger WPML-Kern und **keine
vollständige DJI-1.18-Zertifizierung**. Noch offen sind die komplette
verschachtelte Feldvalidierung, ein visueller Missionseditor,
Vermessungs-/Oblique-Planungsalgorithmen, Geoid-/AGL-Umrechnung,
Terrain Follow, DJI-Wayline-Upload/Download, Medien-/res-Verwaltung,
Missionsstatus samt Gerätebestätigung und Firmware-spezifische Tests.

Nächste Abnahme: mit DJI Pilot 2 exportierte, anonymisierte KMZ-Files für
Mavic 3E, Mavic 3T, Mavic 3M und Matrice 4T einlesen und einzeln
gegen das DJI-Importverhalten prüfen. Besonderheit M3M:
visible-/narrow_band-Linsen, Multispektral-Metadaten und Kameraaktionen
müssen an echten Pilot-2-Exporten getestet werden. Erst danach UI/Dispatch.
