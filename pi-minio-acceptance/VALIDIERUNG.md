# Validierung der vorbereiteten Anleitung

Datum: 22.10.2026. Ausschließlich im separaten Arbeitsverzeichnis des Assistenten.
Keine Verbindung zum Pi, kein Zugriff auf dessen Daten, keine Pi-Ausführung.

## Durchgeführt

- Python-Syntaxprüfung von `manifest.py` und `restore_probe.py` erfolgreich.
- Shell-Syntaxprüfung aller drei Shell-Dateien erfolgreich.
- Acht lokale Tests mit temporären Testdateien erfolgreich:
  - Kopie mit unveränderten Inhalten und Metadaten stimmt überein.
  - Manipulierte Inhalte werden erkannt.
  - Zusätzliche Dateien werden erkannt.
  - Geänderte Dateimodi werden erkannt.
  - Symlinks werden abgelehnt.
  - Fehlendes Quellverzeichnis wird abgelehnt.
  - Backup/Restore ohne ausdrückliches Ausführungsargument brechen vor Aktionen ab.
  - Alle Shell-Dateien sind syntaktisch gültig.
- Manueller Review der festen Quellpfade, Image-ID, Restore-Isolation,
  Fehlerbehandlung und Ausgabeunterdrückung für Zugangsdaten.

## Nicht durchgeführt

- Kein Backup des echten MinIO, keine Unterbrechung und kein Wiederanlauf.
- Keine LUKS-/ext4-Erstellung oder Mountoperation auf dem Pi.
- Keine NTFS-/fallocate-Kompatibilitätsprüfung.
- Kein End-to-End-Test der Pipelines mit den echten etwa 30,5 GiB.
- Kein Test des MinIO-Image-Archivs durch Laden auf einem frischen Host.
- Kein echter Restore, keine tatsächlichen S3-/IAM-Probes aus der Restore-Kopie.
- Keine Mountabsicherung oder Restart-Policy geändert.
- Keine Ausfallzeit gemessen; kein Benchmark und kein Persistenznachweis.
- Shellcheck ist in der lokalen Prüfungsumgebung nicht vorhanden.

Die Skripte sind vorbereitet und lokal geprüft, **nicht hardwareabgenommen**.
Insbesondere kann eine erfolgreiche Syntaxprüfung keine Pi-Ausführung ersetzen.
Vor einer späteren Durchführung alle Preflight-Ergebnisse und den aktuellen
Live-Zustand erneut bewerten. Geänderte Zustände dürfen nicht durch Abschalten
der Schutzprüfungen passend gemacht werden.
