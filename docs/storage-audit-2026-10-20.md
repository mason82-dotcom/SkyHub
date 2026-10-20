# SkyHub Next: lesende Prüfung von PostgreSQL und MinIO

Zeitpunkt: 20.10.2026, etwa 21:46 UTC. Geprüft wurde ausschließlich der Root-Stack. Es gab keine Schreibabfrage, keinen Containerstart, keine Volume-Änderung und keine Ausgabe von Zugangsdaten, Gerätekennungen oder Koordinaten.

## PostgreSQL / PostGIS

- `skyhub-next-postgres-1` lief mit gesundem Containerstatus. Tatsächlich eingebunden war `skyhub-next_pgdata_arm64` auf `/var/lib/postgresql/data`. Das ebenfalls vorhandene Volume `skyhub-next_pgdata` ist **nicht** das aktuell eingebundene Datenvolume und muss erhalten bleiben.
- Die Datenbank `skyhub_next` antwortete auf zwei explizite `READ ONLY`-Transaktionen. PostGIS-Erweiterung: **3.6.4**. Alle sechs in `backend/db/schema.sql` erwarteten Tabellen waren vorhanden. In `drone_telemetry` waren alle sieben nachträglich ergänzten Track-Spalten und beide geprüften Track-Indizes vorhanden.
- `drone_telemetry`: **2.608 Zeilen**, rund **836 kB** inklusive Indizes. Keine Zeile hatte eine fehlende oder ungültige Geometrie. Die letzte gespeicherte Zeile stammt von **21:01:06 UTC**.
- **1.333 historische Zeilen** enthalten die Position `(0, 0)`; **keine Zeile** hat einen gesetzten `source_ts`. Die aktuelle Track-Abfrage blendet `(0, 0)` aus, und die neuere Schreib-Policy speichert solche Punkte nicht mehr. Der Befund zeigt historische Daten vor dieser Policy; er rechtfertigt keine automatische Löschung oder nachträgliche Umdeutung der Zeitstempel.
- Der laufende Backend-Health-Endpunkt meldete MQTT verbunden/abonniert, **331** verwertbare OSD-Updates, `trackPointsSkipped=331` und `trackPointsStored=0` seit dem Backend-Neustart. Der letzte verwertbare OSD-Eingang war **21:15:32 UTC**. Damit ist der Schreibpfad der aktuell laufenden Version **nicht durch einen neuen gespeicherten Punkt belegt**. Die genauen Gründe für die Filterentscheidungen wurden ohne Ausgabe der Gerätedaten nicht weiter aufgeklärt; Stillstand, `(0, 0)` und fehlende gültige GPS-Paare sind mögliche, aber hier nicht nachgewiesene Ursachen.
- Der zuletzt gepushte Code verbessert künftig Health-Zähler und Migrationsdiagnose. Er wurde **nicht** auf den laufenden Container ausgerollt und erklärt daher nicht dessen aktuelle Health-Felder.

## MinIO

- MinIO ist ausschließlich im optionalen Compose-Profil `media` definiert. Die Profil-Konfiguration ist syntaktisch gültig. Sie verwendet das Image `minio/minio:RELEASE.2023-09-04T19-57-37Z`, das interne Volume-Ziel `/data` und veröffentlicht keinen Host-Port.
- Die lokale `.env` enthält Werte für `SKYHUB_MINIO_USER` und `SKYHUB_MINIO_PASSWORD`; sie wurden ausschließlich auf Vorhandensein geprüft und nicht ausgegeben. Die Compose-Konfiguration reicht sie als Root-Zugangsdaten an MinIO weiter.
- Es gab weder einen laufenden noch einen gestoppten `skyhub-next-minio`-Container. Lokal waren weder ein `skyhub-next_minio_data`-Volume noch das konfigurierte MinIO-Image vorhanden. Ein Live-Health-, Bucket- oder Objekt-Test war daher ohne Start des optionalen Dienstes nicht möglich.
- Der Root-Backend-Stack bindet MinIO derzeit nicht ein; eine Medien-API ist noch nicht implementiert. Vor einer Aktivierung sind Speicherort, Backup, Zugangskonzept, Image-Build/Pull und ein isolierter Funktionstest festzulegen.

## Nächster technischer Nachweis

Mit einer **separaten Testdatenbank** die additive Migration, einen gültigen Track-Insert, die Abfrage und die Retention prüfen. Produktive Track-Zeilen und Volumes dabei nicht verändern. MinIO kann erst nach bewusster Aktivierung des `media`-Profils vollständig geprüft werden; diese Prüfung war kein Deployment-Auftrag.
