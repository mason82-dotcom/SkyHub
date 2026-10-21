# Gemeinsame Hardwarediagnose – 22.10.2026

## Ergebnis

Der Branch `develop/hardware-diagnostics-consolidated-20261022` führt die
lesenden Hardwareprüfer für RC Pro Enterprise/Mavic 3M und RC Plus 2
Enterprise/Matrice 4T auf der aktuellen gemeinsamen Basis zusammen.
Er aktiviert keine Hardwarefunktionen und ist kein Pi-Deployment.

| Herkunft | Übernommener Umfang |
| --- | --- |
| `main` bei `4d87831` | Typisierte Kataloge, M3M-Overlay, Feldfrische und Ausschluss flüchtiger OSD-Feldzeiten aus Redis |
| PR #26, `d7c7830` | Korrektur der HTTP-Modellkennungen, echte HTTP-Regression und Bestandsaufnahme |
| PR #21, `aa5fb34` | Hardware-Evidenz für sechs typisierte M3M-Erweiterungspfade; Flugsemantik bleibt ungeprüft |
| PR #22, `12a1519` | M3M-Feldlücken, State-Transport-/Ablehnungsbilanz und feldgenaue State-Abdeckung |
| PR #18, `043d309` | RC-Plus-2/M4T-Evaluator, geschützter GET-Prüfer und Regression unabhängiger Geräte-Tokens |

Die Evidenz- und Lückendiagnosezweige wurden lokal per Dreiwegmerge
zusammengeführt. Der einzige Konflikt betraf eine Erläuterung der
M3M-Typannahme; die Fassung mit explizit nicht validierten Werten,
Grenzfällen und sicherheitsrelevanten Funktionen blieb erhalten.
Aus dem älteren RC-Plus-2-Zweig wurden ausschließlich dessen fünf neue
modellbezogene Dateien übernommen. Der aktuelle gemeinsame Parser,
die Registry, HTTP-Korrektur und RC-Pro/M3M-Diagnose wurden erhalten.

Dieser konsolidierte Vorschlag enthält die oben genannten Teiländerungen.
Die ursprünglichen PRs vor einem späteren Merge gegen den tatsächlich
gewählten Integrationsstand abgleichen; nicht als zusätzliche unabhängige
Features erneut übernehmen. In dieser Arbeit wird keiner dieser PRs gemergt
oder geschlossen.

## Konsistentes State-Verhalten

Beide Prüfer bestätigen den Empfang eines bereits beobachteten State-Ereignisses
auch nach Ablauf der OSD-Frischegrenze. Das Ereignisalter und die Aktualität
jedes einzelnen Felds werden separat berechnet. Der RC-Plus-2/M4T-Prüfer hatte
ältere State-Ereignisse bisher in seiner Empfangsstufe als `NICHT AKTUELL`
angezeigt, obwohl State nur bei Änderung publiziert wird.

Der neue Regressionstest reproduzierte diese widersprüchliche Anzeige vor
der Korrektur. Fehlende und zukünftige State-Zeitstempel bleiben unbestätigt.
Die OSD-Prüfung unter 15 Sekunden und die Pflicht eines verbundenen
Topologie-ACK-Publishers bleiben erhalten. Eine optionale State-Beobachtung
macht weder alte OSD-Daten frisch noch bestätigt sie eine vollständige
Hardware- oder Flugabnahme.

## Neue Offline-Integration

`backend/test/hardware-diagnostics-integration.test.js` verarbeitet synthetische
DJI-Nachrichten durch den tatsächlichen Parser, Eingangszeitfilter, Registry,
MQTT-Metriken und beide Hardware-Evaluatoren. Geprüft werden:

- Zwei unabhängige Gateway-/Fluggerätepaare in derselben Registry, ohne
  Vermischung der Modelle und ihrer Feldkataloge.
- Sechs gültige M3M-Erweiterungspfade und unveränderte Modellumfänge von
  RC Pro 48, M3M 150, RC Plus 2 54 und M4T 199 statischen Feldpfaden.
- Empfangsbestätigung älterer ereignisgesteuerter State-Meldungen bei weiterhin
  unabhängig berechneter OSD-/Feldfrische.
- Keine flüchtigen OSD-Feldzeitkarten in den Redis-Cacheprojektionen.
- M4T-Disconnect-Replay (`mode_code=14`) überschreibt weder letzten Akkustand
  noch Position oder Messzeit und beeinträchtigt das andere Gerätefamilienpaar
  nicht. Der M4T-Prüfer verweigert dabei einen positiven Smoketest.
- Anonymisierte JSON-/Textberichte ohne Testkennungen, Koordinaten oder
  Firmwarewerte.

Der separate Parallel-Pairing-Test verwendet den echten Pairing-Baustein mit
einem RAM-Teststore. Er prüft unabhängige Tokens im selben Workspace und dass
ein Widerruf der neuen RC-Plus-2-Kopplung das RC-Pro-Token wirksam lässt.
Das ist ein Offline-Vertragstest und kein Nachweis paralleler realer DJI-
Sitzungen oder erfolgreicher physischer Kopplung.

## Sichere nächste Prüfung

Die [RC-Plus-2/M4T-Anleitung](hardware-rc-plus2-m4t.md) verweist auf diesen
konsolidierten Branch. Beide CLI-Hilfen und Offline-Tests benötigen keinen
Backend-Neustart. Ein späterer Live-Aufruf liest den vorhandenen Container
über `SKYHUB_COMPOSE_DIR`; er benötigt eine unverändert bereitstehende
Laufzeit und reale Hardware. Vor dem Live-Test den Abschluss der laufenden
MinIO-Sicherung und den aktuellen Pi-Zustand separat feststellen.

Nicht Teil dieses Schritts sind WPML, Medienausbau, Speicherung oder
Wiederherstellung echter Daten, Broker-/IAM-Änderungen und DJI-Steuerbefehle.
Die reale RC-Plus-2/M4T-Abnahme bleibt offen.

## Validierung dieses Stands

Lokal: **283 Node-Tests, 281 bestanden, zwei optionale PostGIS-Tests ohne
separate Datenbank übersprungen**. **9/9 Python-Tests**, JavaScript-/Shell-Syntax,
Dashboard-Inline-Script, beide Hardware-CLI-Hilfen und `git diff --check`
erfolgreich. Der Image-Smoke in CI lädt zusätzlich beide Hardware-Evaluatoren
und den M3M-Lückenklassifizierer ohne Netzwerk. Docker ist lokal nicht vorhanden;
Image-/Compose- sowie echte SQL-/Restore-Nachweise müssen aus CI stammen.
