# SkyHub-Next — YOLO11 als optionale Offline-Bildanalyse

Status: **experimentelles Staging, kein produktiver Dienst**. Quellprojekt:
https://github.com/uav-inspection-development/YoloV11-Object-Detection-for-DJI-Cloud-API

## Befund zum Ausgangsprojekt

Das externe Repository beschreibt die Erkennung von Rissen auf
Photovoltaikmodulen anhand von Elektrolumineszenz-Aufnahmen (EL).
Sein Streamlit/QtFusion-Frontend, das CUDA-Dockerfile und die umfangreichen
Ultralytics-Quellen sind **keine** nachgewiesene DJI-Cloud-API-1.18-
Implementierung. `src/model.py` setzt sogar für beide Pfadvarianten
`task='segment'`; die Quelle ist daher nicht ungeprüft produktionsfähig.
Mitgelieferte `yolo11n.pt`/`yolo11s.pt` sind allgemeine Modellgewichte
und nicht nachweisbar auf EL-Risse oder Mavic-3M-Medien trainierte
Defektdetektoren. Das in der Anleitung erwähnte `best.pt` ist
im Repository nicht vorhanden. Es gibt keine belastbaren Benchmarks
auf SkyHub-Hardware.

## Integrierter, standardmäßig deaktivierter Scope

`backend/workers/vision_yolo11_offline.py` ist ein ausdrücklich
aufzurufender CLI-Worker für **eine** lokale JPEG/PNG-RGB-Datei.
Er fordert einen **absoluten lokalen** Bild- und Modellpfad,
setzt CPU-Inferenz, begrenzt Bildgröße, Pixelzahl, Modellgröße und
Detektionszahl und liefert ausschließlich JSON mit:
- `schema=skyhub-vision-yolo11-preview-v1`, Status und Bildabmessungen;
- Klasse, Score und Pixel-Bounding-Box je Detektion;
- den festen Freigabefeldern `defectVerified=false`,
  `geolocationVerified=false`, `multispectralReady=false` und
  `flightControlReady=false`.

Keine Objektpfade, Seriennummern, GPS-/EXIF-/XMP-Werte oder Tokens
werden in JSON aufgenommen. Ergebnisse sind **unverifizierte
Modellvorhersagen**, keine Diagnose, Georeferenzierung, Vegetationsindizes
oder Fluganweisungen. Das Modul liest weder MinIO noch PostgreSQL,
verarbeitet keine Live-RTSP-Streams und startet keinen Netzwerklistener.
Der bestehende Pilot-2-/M3M-Pfad bleibt unverändert. Insbesondere darf
der normale Medienkatalog nicht ohne Identitätsprüfung und
Berechtigungskontrolle in einen GPU-Job umgeleitet werden.

### Entwicklung auf einem isolierten Rechner/Worktree

```bash
git fetch origin
git worktree add ../SkyHub-Vision-Test \
  origin/feature/skyhub-next-yolo11-offline-analysis-20261023
cd ../SkyHub-Vision-Test
python3 -m unittest discover -s tests -p 'test_vision_yolo11_offline.py'
python3 -m py_compile backend/workers/vision_yolo11_offline.py

# Nur auf separatem Analysehost/virtuellem Environment; keine Installation
# in die produktive SkyHub-Next-/Hermes-Python-Umgebung:
python3 -m venv .venv-vision
. .venv-vision/bin/activate
python -m pip install -r backend/workers/requirements-vision-yolo11.txt

python backend/workers/vision_yolo11_offline.py \
  --image /absoluter/pfad/zu/bild.jpg \
  --model /absoluter/pfad/zu/reviewed-model.onnx
```

Einen eigenen, tatsächlich auf die gewünschte Aufgabe trainierten
und validierten Modellstand einsetzen; die allgemeine COCO-Klasse
`person` oder `car` ist **keine** Risserkennung.
PyTorch-`.pt`-Modelle sind wegen möglicher Codeausführung beim
Deserialisieren standardmäßig gesperrt; ausschließlich nach expliziter
Prüfung mit `--allow-trusted-pt` freigeben. Auch ONNX-Dateien sind
vor Nutzung hinsichtlich Herkunft, Version und Integrität zu prüfen.
Das Kommando arbeitet nur mit lokalen Dateien; vorab Bilder ohne
sensible EXIF-Inhalte in einen isolierten Testbereich kopieren.
Weder Quellgewichte noch Bildbeispiele sind im SkyHub-Repository
enthalten. Für reproduzierbare Einsätze Dependencies/Modelle
versionieren und deren SHA-256 separat attestieren.

## Integration in die DJI-Medienpipeline: noch offen

1. **Asset-Identität**: ausschließlich per Pilot-2 verifizierte,
   workspace-gebundene Medien (persistierte Datenbank + gültiges
   S3-HEAD mit Objektidentität) für eine spätere Jobfreigabe verwenden.
2. **Abgetrennter Worker**: isolierte Queue/Jobverwaltung,
   resource limits, reine Leserechte, explizite Exportfunktion;
   niemals MinIO-Root-Credentials oder MQTT-Publisher einbinden.
3. **Medienarten**: JPEG-RGB/EL getrennt von radiometrisch
   kalibrierten Mavic-3M-TIFF-Bändern halten. `*.TIF` wird vom
   YOLO-RGB-Preview absichtlich abgewiesen.
4. **Anwendungslogik**: PV-EL-Risserkennung benötigt ein
   entsprechend trainiertes, validiertes Modell und geeignete
   EL-Aufnahmen. Thermische M4T-Bilder, sichtbare PV-Defekte
   oder RGB-Objekte erfordern separat qualifizierte Datensätze.
5. **Ausgabe**: erst nach Freigabe validierte Asset-IDs mit
   Detektionsannotation im UI; keine automatische Flugsteuerung.
6. **Freigabetests**: echtes Bild/Modell, Offline-Laufzeit-
   /CPU-Benchmark, Memory-Limits, Sicherheitsreview und
   DJI-Cloud-API-1.18-End-to-End-Test.

## Lizenz-/Deployment-Grenzen

Das GitHub-Ausgangsrepository enthält eine Apache-2.0-LICENSE,
jedoch ist die verwendete **Ultralytics-Software inklusive
YOLO-Modellgewichte separat AGPL-3.0/Enterprise-lizenziert**.
Die Aufnahme der externen Quellcodekopie oder die automatische
Installation im produktiven Backend wäre darum technisch und
lizenzrechtlich falsch. Vor kommerziellem, proprietärem,
Netzwerk- oder SaaS-Einsatz Lizenzpflichten prüfen bzw. eine
passende Enterprise-Lizenz einholen:
https://www.ultralytics.com/license

Keine Änderung an `docker-compose.yml`, `server.js`,
MQTT-ACL, Datenbank, Pilot-2-Authentifizierung oder
bestehenden Diensten ist Teil dieses Staging-Branches.


## Python-zu-Node-Vertragsgrenze (ohne produktiven API-Endpunkt)

`backend/vision-preview-contract.js` akzeptiert ausschließlich das
exakte `skyhub-vision-yolo11-preview-v1`-Format, lehnt zusätzliche
Felder, übergroße Antworten, ungültige Klassen/Pixel-Boxen und frei
erfundene Freigabewerte ab. `scripts/vision-preview-validate.js` liest
ausdrücklich weitergereichte JSON-Daten von stdin und gibt nur einen
bereinigten Report beziehungsweise `status=unavailable` zurück.

Beispiel für einen sicheren lokalen Test mit vorhandenen, isolierten
Bild- und Modelldateien:

```bash
set -o pipefail
python3 backend/workers/vision_yolo11_offline.py \
  --image /absolut/preview.jpg \
  --model /absolut/geprueftes-modell.onnx \
  | node scripts/vision-preview-validate.js
```

Kein Resultat wird hierdurch automatisch veröffentlicht, gespeichert
oder mit einer Flugmission verknüpft. Ein künftiger Medienverknüpfungsjob
muss Asset-/Workspace-ID und geprüftes S3-HEAD **außerhalb dieses
Modellformats** autorisieren, bevor Ergebnisse persistiert werden.
Tests: `node --test backend/test/vision-preview-*.test.js`.
