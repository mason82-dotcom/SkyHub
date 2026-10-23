# Kompatibilitätsmatrix – refactored-system vs. SkyHub-Next

Stand: 2026-10-23. Upstream festgeschrieben auf `b942812e7aac9968ba1cce612a16769b1de9a8c2`. Verglichen mit `feature/dji-wpml-offline-20261021`, Ausgangscommit `1d9e8316fae189054d65e1a38689df4d2315dfac`.

| Thema | Befund | Entscheidung |
| --- | --- | --- |
| KMZ-Layout | Upstream-`package_kmz.py` schreibt `template.kml` und `waylines.wpml` direkt ins Archiv. `validate_wayline.py` erwartet diese Dateien ebenfalls im Stammverzeichnis. DJI FlightHub 2 schreibt explizit `wpmz/template.kml` und `wpmz/waylines.wpml` vor. | **Upstream-Archivcode nicht übernehmen.** SkyHub-`packageKmz` exportiert `wpmz/`-Layout. |
| KMZ-Import | SkyHub-`readKmz` toleriert aktuell zusätzlich Root-Pfade zum lesenden Vergleich älterer/abweichender Dateien. Das ist **keine Behauptung offizieller Importkompatibilität**. | Bestehenden Importvertrag nicht unbemerkt ändern; Exporte bleiben `wpmz/`. |
| Aircraft-Enums | Upstream-`validate_wayline.py` erlaubt nur `60,67,77,89,91`. Die DJI-/SkyHub-Profile für Matrice 4T (`99/1`) und Matrice 4D/4TD (`100/0,100/1`) fehlen. | Upstream-Validator nicht als normativen Freigabeprüfer einsetzen. |
| Payloads | SkyHub besitzt modellbezogene Kombinationen; z. B. Matrice 4T `99/1` mit Kamera `89`, Mavic 3M `77/2` mit WPML-Kamera `68`. | Modell/Payload gemeinsam und kontextgebunden prüfen. Ein WPML-Profil belegt noch keine Hardwarebestätigung. |
| WPML-Sondermodi | Upstream-`targetdetection` stammt nach eigener Dokumentation aus unvollständig belegten Pilot-2-Beobachtungen, nicht aus dem fixierten offiziellen WPML-Feldbestand. | Nur experimentell dokumentieren; keine automatische Freischaltung. |
| MQTT | Upstream-`validate_mqtt.py` prüft Topic-Hülle, Typen und nur wenige Methodendetails. Keine vollständige Authentisierung, Zustandsmaschine, Methodenabdeckung oder Flugfreigabe. | Keine produktive Nachrichten-/Command-Pipeline daraus ableiten. |
| Cloud-API-Version | Upstream-Dokumentbasis vom 2024-11-07; SkyHub-Zielstand 1.18 mit noch offenen gerätespezifischen Hardwareprüfungen. | Neue Felder ausschließlich mit DJI-Primärquelle, Geräteprofil und Testbeleg. |
| Sicherheit | Upstream besitzt positive und negative Tests einschließlich Dateigrößen-, Koordinaten- und Archivchecks. SkyHub besitzt zusätzlich CRC32-, ZIP64-/Symlink-, Größen- und Pfadprüfungen. | Nur ergänzende Grenzfalltests; kein zweiter produktiver Validator. |
| Betrieb | Upstream-Skills können Aktionen für Agenten vorschlagen. | Keine automatische Skill-Aktivierung und keine Geräte-/Netzwerkrechte. |

## Direkter Quellennachweis

- Upstream-WPML-Validator: https://github.com/wsadexq/refactored-system/blob/b942812e7aac9968ba1cce612a16769b1de9a8c2/dji-wpml/scripts/validate_wayline.py
- Upstream-KMZ-Packer: https://github.com/wsadexq/refactored-system/blob/b942812e7aac9968ba1cce612a16769b1de9a8c2/dji-wpml/scripts/package_kmz.py
- Upstream-MQTT-Validator: https://github.com/wsadexq/refactored-system/blob/b942812e7aac9968ba1cce612a16769b1de9a8c2/cloud-api/scripts/validate_mqtt.py
- Offizielles DJI-Importformat: https://fh.dji.com/user-manual/en/flight-route-library/import-flight-routes.html
- DJI Geräte-/Payload-Typen: https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-support.html

## Einordnung zu realer Hardware

Die vorhandene SkyHub-Entwicklung trennt XML-Formatprüfung, modellbezogene Feldtabellen, real beobachtete Pilot-2-OSD-Werte und eine tatsächliche Hardwareabnahme. Insbesondere bleibt die Kamera-ID `68` für die Mavic 3M in der Cloud-API-Topologie trotz der vorhandenen WPML-Zuordnung gesondert zu verifizieren. Keine offline-validierte KMZ darf dadurch `flightReady=true` erhalten.
