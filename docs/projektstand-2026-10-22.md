# SkyHub Next: erneute Bestandsaufnahme und nächste Entwicklung

Stand: 22.10.2026. Quellcodebasis: `main` bei
`4d878314f8345f8cd370f0004916426523e577c0` im Repository
`mason82-dotcom/SkyHub`. Git-Referenzen und offene Pull Requests wurden neu
gelesen. Dieser Bericht beschreibt den Repository-Stand; er ersetzt keine
aktuelle Inventur des Raspberry Pi. Es wurde keine Verbindung zum Pi aufgebaut.

## Architektur und tatsächlicher Funktionsumfang

- Der aktive Root-Stack ist SkyHub Next: Node/Express, Socket.IO, MQTT,
  RAM-Geräteregistry, Redis und PostGIS. Der Legacy-Stack ist Referenz.
- `server.js` verbindet Parser, Eingangsprüfung, Registry, Pilot-Pairing,
  optionale Topologieantworten und HTTP-/Socket-Zugriff. Die Diagnose muss
  Brokerverbindung, angenommenes OSD, Gerätezuordnung und Feldfrische getrennt
  bewerten. Ereignisgesteuertes State hat andere Aktualitätsbedingungen als OSD.
- Positionen erfordern ein zusammen empfangenes Koordinatenpaar. Teilpakete,
  `(0,0)` und die Replay-Meldung nach Trennung des Fluggeräts dürfen ältere
  Werte nicht als neue Position oder frische Messung ausgeben.
- Der Gerätekatalog und der typisierte Property-Katalog sind unterschiedliche
  Abdeckungen. Sechs Modellprofile besitzen Felddefinitionen; eine bekannte
  Modellbezeichnung allein belegt keine vollständige Property-Unterstützung.
- Track-Aufzeichnung ist standardmäßig aus. Der Recorder zählt bestätigte,
  ausstehende und fehlgeschlagene Writes getrennt. Die Kartengruppen-GET-Route
  ist optional; die Mutationsengine wird vom Server nicht geladen.
- Medien-API und M3M-Inventur liegen auf einem eigenen Branch. Die Python-Worker
  im Root erzeugen Demonstrationsdaten und sind keine echte radiometrische,
  thermische oder photogrammetrische Verarbeitung.
- Compose-Defaults (Loopback 4001, vorhandener Broker 1884, keine öffentlichen
  DB-/Redis-Ports) sind keine Aussage über lokale Pi-Overrides.

## Entwicklungszweige und Abhängigkeiten

Die Spalte „fehlt / zusätzlich“ zählt Commits gegenüber dem oben genannten
`main` mit `git rev-list --left-right --count main...<branch>`. Sie zählt
Historie, keine Fehler oder unabhängigen Features. PR-Status und SHA sind eine
Momentaufnahme und müssen vor einer Integration neu geprüft werden.

| PR | Branch | Head | fehlt / zusätzlich | Konsequenz |
| --- | --- | --- | --- | --- |
| #21 | `docs/m3m-typed-acceptance-hardware-20261021` | `aa5fb34` | 0 / 6 | Hardware-Evidenz für sechs M3M-Pfade; Typannahme belegt keine Flugsemantik. |
| #22 | `test/m3m-camera-capability-gap-audit-20261021` | `12a1519` | 0 / 19 | Feldlücken und State-Duplikate klassifizieren; nicht automatisch als Parserfehler zählen. |
| #18 | `develop/rc-plus2-m4t-cloudapi118-20261021` | `043d309` | 2 / 22 | Neuere `main`-Änderungen zuerst abgleichen; echte RC-Plus-2-/M4T-Abnahme offen. |
| #16 | `feature/dji-wpml-offline-20261021` | `1d9e831` | 5 / 176 | PR-Basis ist der ältere Feldkatalogbranch; Schutzkorrekturen und Hardwareprüfer aus `main` erhalten. |
| #19 | `feature/shared-minio-storage-20261021` | `c5a77fe` | 1 / 66 | Speicherübernahme ist ein eigener Betriebsweg, keine allgemeine Update-Anweisung. |
| #23 | `feature/m3m-media-inventory-readonly-20261021` | `427e37b` | separat | Offline-Namensinventur überschneidet sich mit #24; nicht doppelt integrieren. |
| #24 | `feature/m3m-minio-integration-20261021` | `6498005` | 0 / 38 | Authentifizierte lesende Medien-API, Inventur und begrenzte TIFF-Prüfer; keine freigegebene Analysepipeline. |
| #25 | `ops/minio-backup-restore-runbook-20261022` | `d661ea9` | 0 / 3 | Abgetrennter Backup-Auftrag und geschützter Wiederanlauf; Restore separat offen. |

Auch der alte Draft #1 ist weiterhin offen. Er beschreibt einen historischen
Entwicklungsstand und ist keine alternative aktuelle Releasebasis.

Besonders der direkte Dateivergleich des WPML-Branches gegen `main` zeigt
fehlende jüngere Cache-/Frische- und Hardwarevalidierungsdateien. Das ist eine
Branch-Divergenz, kein Beweis, dass ein Git-Dreiwegmerge diese Dateien löschen
würde. Vor einer Übernahme sind jedoch ein gezielter Abgleich und die gesamte
aktuelle Regression erforderlich; keine Dateien pauschal durch den älteren
Branchstand ersetzen.

## Konkrete Korrektur dieser Entwicklung

`GET /api/diagnostics/dji-fields?model=0:77:2` wurde trotz gültiger Kennung mit
HTTP 400 abgewiesen. Im Regex-Literal standen doppelte Backslashes vor `d`;
dadurch wurde ein literales Backslash-/d-Muster statt einer Dezimalzahl geprüft.
Die Katalogfunktionen selbst waren davon nicht betroffen.

Die Route akzeptiert nun wieder die dokumentierten Modellkennungen. Neue
Tests starten die echte Express-App auf einem zufälligen lokalen Port und prüfen:

- HTTP 200 und den vollständigen Kataloginhalt für alle sechs Modellprofile;
- HTTP 400 für fehlende, fehlerhafte, mehrfache und strukturierte Modellparameter,
  einschließlich des bisher fälschlich akzeptierten Backslash-/d-Musters;
- HTTP 404 für eine syntaktisch gültige, unbekannte Modellkennung;
- HTTP 401 ohne View-Token, auch aus dem freigegebenen LAN und mit Pilot-Token.

Vor der Korrektur schlugen die zwei neuen funktionalen HTTP-Tests gezielt fehl;
anschließend bestanden sie. Diese Änderung erfordert weder neue Abhängigkeiten
noch eine Datenmigration.

## Priorisierte Fortsetzung

1. **P0: laufende Sicherung abschließen und Ergebnis belegen.** Die zuletzt
   übermittelte Pi-Ausgabe meldete das Streaming des verschlüsselten Archivs.
   Ein erfolgreicher Abschluss, die Integrität des Archivs und MinIO-Readiness
   nach Wiederanlauf sind damit noch nicht nachgewiesen. Keinen parallelen
   Sicherungsauftrag, Neustart oder Eingriff in den Datenpfad daraus ableiten.
2. **P1: gemeinsame Diagnosebasis stabilisieren.** Diese API-Korrektur separat
   reviewen und durch CI prüfen. Danach #21/#22 nach aktuellem Diff konsolidieren.
   Git-Merge und Pi-Deployment bleiben getrennte Schritte.
3. **P1: RC Plus 2 / M4T auf aktuelle Basis bringen.** Die fehlenden `main`-
   Korrekturen berücksichtigen, Parallel-Pairing-Regression ausführen und erst
   danach mit realer Hardware Topologie, ACK, OSD und Token-Nutzung abnehmen.
4. **P2: WPML konsolidieren.** Frische-/Cache-Schutz und aktuelle Hardwarediagnose
   erhalten; Offline-KMZ- und Kameraaktionsprüfungen erneut ausführen. Validierte
   Dateistruktur, unterstützte Hardware und Flugfreigabe getrennt behandeln.
5. **P2: Speicherabnahme abschließen, dann Medienarbeit fortsetzen.** Restore,
   Persistenz-/Mountabsicherung und IAM-/Clientinventur bleiben offen. Bis dahin
   M3M-/Smart-Farming-Ausbau pausieren. Sechs TIFF-Signaturen belegen weder
   M3M-Herkunft noch Bandzuordnung, Kalibrierung, Reflexion, NDVI oder NDRE.

## Lokale Validierung und Grenzen

- Node-Suite: **249 Tests, 247 bestanden, 2 übersprungen**, keine Fehler.
  Die beiden optionalen PostGIS-Integrationstests benötigen eine separate
  Testdatenbank; hier wurde keine bereitgestellt.
- Python: **9/9 Tests bestanden**.
- Ausgeliefertes Dashboard-Inline-JavaScript erfolgreich geprüft.
- JavaScript- und Shell-Syntax sowie `git diff --check` geprüft.
- Docker ist in dieser Arbeitsumgebung nicht installiert. Compose-Prüfung,
  Image-Build und echte SQL-/Dump-/Restore-Jobs sind deshalb lokal nicht
  ausgeführt; dafür sind die vorhandenen CI-Jobs erforderlich.
- Keine Pi-, DJI-, MQTT-, S3-, Storage-, IAM- oder Produktivänderung.
