# Bewertung: refactored-system als ergänzende DJI-Referenz

**Ergebnis: Ja, als lesende, versionierte Referenz und Quelle zusätzlicher Regressionstestideen. Nein, als direkt eingebundener Validator, Import-Packer oder Flugsteuerungskomponente.**

**Stand:** 2026-10-23. Externe Quelle `wsadexq/refactored-system` auf Commit `b942812e7aac9968ba1cce612a16769b1de9a8c2`; Basis dieses Reviews ist der isolierte WPML-Feature-Branch von SkyHub, nicht die Pi-Produktivinstallation.

## Bestandteile und Nutzen

- `dji-wpml`: WPML-Beispiele, `template.kml`/`waylines.wpml`, offline Validator-/Packer-Skripte. Nutzen: Negativfälle und Dokumentations-Quervergleich; Archivpacker nicht übernehmen.
- `cloud-api`: MQTT-Topic- und Nachrichtenreferenzen zu Pilot-/Dock-Szenarien, HMS und DRC. Nutzen: Checklisten für SkyHub 1.18; keine Behauptung vollständiger Methodenschemata.
- Agent-Skills: Struktur für bedarfsgesteuertes Laden von Referenzwissen. Nutzen: mögliches eigenes, neu geprüftes Hermes-/Codex-Know-how; externen Inhalt nie mit Device-/Shell-Rechten automatisch ausführen.
- Tests: Positiv-/Negativbeispiele auf Datei- und Nachrichtenebene. Nutzen: getrennte, synthetische Regressionstests ohne fremden Code.

## Bewertung

| Kategorie | Urteil |
| --- | --- |
| Dokumentations-Provenienz | **Nützlich**: klare Trennung von offiziellem Snapshot, Beobachtung und Testabdeckung |
| WPML/Archiv | **Nicht übernehmen**: Upstream schreibt Root-Dateien statt des offiziellen `wpmz/`-Importlayouts |
| Modelle | **Unvollständig**: Matrice 4T und weitere aktuelle Gerätetypen fehlen im Upstream-Validator |
| MQTT/Cloud-API 1.18 | **Nur erklärende Referenz**: nicht versioniert gegen 1.18 und nicht vollständig methodenspezifisch |
| TargetDetection | **Forschung**: unzureichend belegte Export-/Firmwarekompatibilität |
| Sicherheitsgrenze | **Keine Live-Aktionen**: Offline-Tests bedeuten weder Importfähigkeit noch flugfähige Mission |

## Status und Integration

- `SOURCE.md`: Source-Commit, offizielle Quellen, Lizenz- und Vertrauensgrenzen.
- `COMPATIBILITY.md`: konkrete Abweichungen und SkyHub-Entscheidungen.
- `TEST-GAPS.md`: neue synthetische Regressionen und verbleibende Hardware-/API-Abnahmepunkte.
- `backend/test/wpml-third-party-reference.test.js`: ergänzende, rein offline Tests.
- Kein Fork, Submodule, Git-Abhängigkeitsdownload, automatischer Agent-Skill, Python im Produktivstack oder externes Code-Vendoring.
- Keine Änderung an existierenden Serverrouten, MQTT-Topic-Abonnements, Docker-Dateien oder Flugsperren.

## Nächste Entscheidungsgrenze

Erst nach erfolgreich ausgeführter Node-Testsuite, Review des Draft-PR und einem erneuten DJI-1.18-Feldabgleich entscheiden, ob einzelne zusätzliche Testideen übernommen werden. Für neue Control-/Wayline-Funktionen ist separat eine modell- und firmwarebezogene Hardwareabnahme erforderlich.
