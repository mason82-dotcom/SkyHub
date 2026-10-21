# Mavic 3M über bestehenden MinIO: sichere Pi-End-to-End-Leseprüfung

Stand 21.10.2026 · Entwicklungsbranch: feature/m3m-minio-integration-20261021

## Ziel und Datengrenzen

Dieser Test verarbeitet die **existierende** SkyHub-Medien-API
GET /api/media/objects aus dem bereits laufenden Backend. Er deployt
**nicht** die neue Route /api/media/m3m/inventory. Der lokale
Inventurcode kann so unmittelbar gegen die gespeicherten S3-Objekt-
**Namen** geprüft werden, ohne den produktiven DJI-/MQTT-Prozess neu zu
starten oder anzupassen.

Das Testprogramm scripts/pi-m3m-s3-inventory-check.js verwendet:

- exakt den erlaubten Bucket dji-cloud und den **explizit angegebenen**
  Prefix; es gibt keinen impliziten Bucket-Root-Scan;
- höchstens 200 Objekte je S3-Seite und höchstens 101 Seiten;
  unvollständige Ergebnisse werden **nicht** als Gesamtinventur ausgegeben;
- **nur** Lesebefehle an die bereits authentifizierte Medien-API;
- den bereits **im Backend-Container vorhandenen** View-Token,
  ohne dessen Wert in Prozessargumente, Logs oder Ausgaben zu schreiben;
- flüchtige, begrenzte Docker-stdout-Pipes für Objektnamen zwischen
  Container und lokalem Elternprozess, ohne Dateispeicherung;
- ausschließlich aggregierte Gesamt-/Band-/Vollständigkeitszähler
  in der Terminalausgabe, ohne Objektschlüssel, Namen,
  Aufnahmezeit, Koordinaten oder Prefix.

Es gibt **keine** neuen Container, keine neuen Netzwerk-S3-Abos,
keine Schreiboperationen und keinen DJI-Steuerbefehl.

## Auf dem Pi ausführen

Nur wenn der vorhandene lokale Branch sauber ist:

    cd ~/Projekte/SkyHub-Next || exit 1
    git status --short --branch
    git fetch origin

    # Fast-forward nur bei sauberem lokalen Checkout!
    # Kein reset --hard, kein stash ohne Prüfung.
    git pull --ff-only origin feature/m3m-minio-integration-20261021

    node --test \
      backend/test/pi-m3m-s3-inventory-check.test.js \
      backend/test/m3m-s3-inventory.test.js \
      backend/test/media-api.test.js

    node scripts/pi-m3m-s3-inventory-check.js --help

### Ohne Angabe eines privaten Bucket-Pfads starten

Wenn der genaue Ordnername nicht bekannt ist, kann der Prüfer den
**ersten 100 Einträgen** des bereits geschützten dji-cloud-Buckets
einen einzigen wahrscheinlichen M3M-Ordner zuordnen.
Er verlangt dafür mindestens **zwei** passend benannte Dateien in
**genau einem** Verzeichnis. Bei mehr als einem passenden Verzeichnis,
ungültigen Schlüsseln oder nur einer passenden Datei bricht er ab.
Er gibt weder den ermittelten S3-Prefix noch einzelne Namen aus.

    SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
      node scripts/pi-m3m-s3-inventory-check.js \
      --auto-first-page

Wenn die erste Seite einen eindeutigen Ordner identifiziert, wird
**nur dieser** Prefix anschließend bis zum bestehenden Limit von
101 S3-Seiten vollständig inventarisiert. Die JSON-Antwort enthält
discoveryScope=first-100-entries-only. Das bezieht sich **nur auf
die Ordnersuche**; es ist kein Beweis, dass dieser Ordner der
einzige M3M-Ordner des ganzen Buckets ist.

Beim zuvor auf dem Pi berichteten Teilausschnitt fanden sich
3 M3M-ähnliche Dateien in genau einem gemeinsamen Unterverzeichnis.
Das rechtfertigt diesen vorsichtigen Versuch, bestätigt jedoch
keine Vollständigkeit des gesamten Buckets.

Anschließend den **tatsächlich bekannten** M3M-Prefix auswählen.
Nicht die vorhandenen Objekt-IDs, Positionsdaten, Bucket-Schlüssel
oder den Prefix hierher kopieren. Beispiel mit **Platzhalter**, der
an den realen Medienpfad angepasst werden **muss**:

    SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
      node scripts/pi-m3m-s3-inventory-check.js \
      --prefix "missions/MEIN_BEKANNTER_M3M_ORDNER/"

Der Reader spricht nur die bereits laufende, authentifizierte
HTTP-Schnittstelle im bestehenden skyhub-next-Backend an.
Bei einem Auth-/Netzwerk-/Pagination-Fehler wird **nur eine generische
Fehlermeldung** gedruckt (Exit-Code 2). Ein vollständiger Scan
beweist ausschließlich Dateinamen-Konventionen, nicht Dateiinhalte
oder Bildqualität. ndviReady, ndreReady und Reflektanz-Flags bleiben
ausdrücklich false.

## Weitere technische Freigabegrenzen

Die spätere Live-Abnahme des *deployten* Endpoints
GET /api/media/m3m/inventory?prefix=... inklusive HTTP 401 ohne
View-Token bleibt getrennt. Der hier beschriebene Test ist **kein
Auftrag, jetzt das produktive Backend neu zu erstellen**.

Bestehende MinIO-Objekte werden nicht geändert oder migriert.
PR #19 (geteilter MinIO), PR #23 (Offline-Inventur) und der
Integrations-PR teilen Teile ihres Codes; vor einem Merge
muss die Reihenfolge und Doppelung geprüft werden.
Bei positivem Nameninventar sind M3M-RGB-/TIFF-XMP-Verifikation,
radiometrische Korrektur und Bandregistrierung separat abzunehmen.


## Echte Pi-5-Live-Abnahme: 424 direkte Objekte (21.10.2026)

Der Benutzer hat aus dem Worktree auf Commit `211c214` acht
Node-Tests erfolgreich ausgeführt und anschließend den bereits
laufenden authentifizierten Medien-GET-Endpunkt mit
`--auto-first-page` gelesen. Der aktive Pi-Container wurde
dabei weder neu gestartet noch verändert. Die anonyme Zählung:

| Merkmal | Wert |
|---|---:|
| Direkt gelistete Objekte im eindeutig erkannten Prefix | 424 |
| Strikt passende M3M-Dateinamen | 3 |
| Noch nicht klassifizierte Namen | **421** |
| Invalide Namen | 0 |
| RGB / Green / Red / RedEdge / NIR | **1 / 0 / 1 / 0 / 1** |
| Mutmaßliche Capture-Gruppen | 2 |
| Vier-Spektral-/Fünf-Kanal-Sets | **0 / 0** |
| Unvollständige Gruppen | 2 |
| Doppelbelegte Kanäle | 0 |

Die **komplette Paginierung innerhalb des ausgewählten Prefixes**
war erfolgreich; `discoveryScope=first-100-entries-only` bezieht
sich ausschließlich auf die **Suche des Prefixes**, nicht auf
die darauf folgende 424-Objekte-Inventur. Andere Prefixe im Bucket
wurden nicht vollständig durchsucht.

**Kein Nachweis fehlender M3M-Sensoraufnahmen:**
421 der 424 Objekte sind unter den streng unterstützten
Original-Dateinamensmustern noch *unbekannt*. Der erste
Live-Scan konnte nicht unterscheiden, ob darunter weitere
JPG/TIF-Varianten, fremde Medienformate oder anders benannte
Multispektralbilder liegen. Deshalb **nicht** automatisch fehlende
Bildkanäle nachladen, S3-Objekte umbenennen oder
Vegetationsindizes berechnen.

### Folgeprüfung: anonyme Dateiformat-Verteilung

Die Offline-Inventur wurde um eine ausschließlich
**kategorienbasierte** Aufschlüsselung der nicht erkannten
Objektnamen ergänzt:

- `unrecognizedFormats`: feste Schlüssel JPEG, TIFF,
  DNG, PNG, MP4, MOV, LRF, SRT, JSON, XML, KMZ,
  OTHER_EXTENSION, NO_EXTENSION mit **ausschließlich Zählwerten**;
- `unrecognizedDjiPrefixedImages`: Anzahl sonstiger
  JPEG-/TIFF-/DNG-/PNG-Namen, die mit `DJI_` beginnen;
- `unrecognizedOtherImages`: Anzahl anderer Bildnamen.

Weder beliebige Dateiendungen, Objektschlüssel, Aufnahmezeiten,
Dateinamen, S3-Prefixe noch sonstige Metadaten werden kopiert
oder im Ergebnis wiedergegeben. Dateiendungen sind **kein
Dateiinhaltsbeweis**. Zur Messung den aktualisierten Branch
per Fast-forward ziehen und **denselben**, rein lesenden
Aufruf wiederholen:

    SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
      node scripts/pi-m3m-s3-inventory-check.js --auto-first-page

Eine hohe `unrecognizedFormats.JPEG`-/TIFF-Anzahl und
ein hoher `unrecognizedDjiPrefixedImages`-Zähler würden
zunächst eine sichere Analyse alternativer Namensmuster
rechtfertigen. Sind überwiegend MP4/andere Formate vorhanden,
ist eine Änderung des M3M-Dateinamenparsers voraussichtlich
nicht zielführend. Keine Originaldatei muss zur Entscheidung
heruntergeladen werden.


## Realer Pi-Nachtest: 421 unbekannte Dateien nach Dateityp

Der Benutzer hat am 21.10.2026 die private MinIO-Medieninventur
erneut ausgeführt; die beiden lokalen Node-Suiten meldeten
**17/17 bestandene Tests**. **Alle 424 direkten Objekte**
des automatisch ausgewählten Prefixes wurden vollständig
paginiert, ohne Namen oder Schlüssel auszugeben.

Die **421** bislang unbekannten Dateinamen lassen sich bereits
anhand ihrer Endung aufschlüsseln:

| Kategorie | Unbekannte Namen |
|---|---:|
| JPEG/JPG | 398 |
| TIFF/TIF | 6 |
| KMZ | 17 |
| Alle anderen Kategorien | 0 |
| **Summe** | **421** |

Unter den **404 unbekannten Bildern** beginnen **37 mit**
dem festen Namensprefix \`DJI_\`, **367 nicht**.
Die zusätzlichen **3 bereits erkannten M3M-Dateinamen**
teilen sich in RGB=1, Red=1 und NIR=1 auf, verteilt auf
zwei partielle Aufnahmegruppen. Green/RedEdge und vollständige
Fünf-Kanal-Gruppen waren unter den *bereits unterstützten
Namensmustern* nicht nachgewiesen.

**Keine Schlussfolgerung über tatsächliche Bildinhalte:**
Die sechs TIFF-Dateien sind der wichtigste nächste
Namensformat-Kandidat. Aus der bisherigen Summe
\`unrecognizedDjiPrefixedImages=37\` allein lässt sich jedoch
**nicht** erkennen, wie viele davon TIFFs statt JPEGs sind.
Ebenso kann ein anders benanntes JPEG anderen Geräten oder
Diensten zugeordnet sein. Es gibt keinen Anlass, 398 JPEGs als
M3M-RGB-Aufnahmen oder 17 KMZ-Dateien als einzelne Flüge
zu zählen.

Der nachfolgende Code-Stand ergänzt daher
\`unrecognizedImagesByPrefix.djiPrefixed\` und
\`unrecognizedImagesByPrefix.other\`, jeweils nur mit den
**festen** Unterkategorien JPEG/TIFF/DNG/PNG.
Diese Zähler erlauben eine sichere Entscheidung, ob
DJI-artig benannte TIFFs tatsächlich im unbekannten Bestand
vorliegen. **Dieser zusätzliche Cross-Tab ist noch nicht mit
echten Pi-Daten getestet**.

Weiterhin sind alle Kalibrierungs-, Bandregistrierungs- und
NDVI/NDRE-Freigabeflags \`false\`. Ein Bilddownload,
Umbenennen oder Dateiinhaltscheck wurde nicht durchgeführt.



## Nachtest: Unbekannte TIFF-Dateien getrennt nach DJI-Präfix (21.10.2026)

Der Nutzer hat 18/18 lokale Node-Tests auf dem Pi bestanden und den
vollständig paginierten, automatisch ausgewählten Prefix erneut analysiert:

- 424 direkte Objekte; 421 unbekannte Dateinamen.
- Davon 398 unbekannte JPEG, 6 unbekannte TIFF und 17 KMZ.
- Die **37 unbekannten DJI_-präfigierten Bilder sind ausschließlich JPEG**.
  Unter den **sechs unbekannten TIFF-Dateien beginnen null mit DJI_**.
- Die 361 übrigen unbekannten JPEGs und sechs TIFFs tragen kein
  DJI_-Präfix. Drei ausdrücklich erkannte M3M-Dateien (RGB, R, NIR)
  ändern diese Einteilung nicht.
- In dieser Namensanalyse: 0 vollständige Vierband-/Fünfband-Sets.
  Das ist keine Aussage über Sensorwerte oder vollständige
  M3M-Bildbestände in anderen S3-Prefixen.

### Zusätzliche streng begrenzte TIFF-Namenshinweise

Die Diagnose zeigt künftig ausschließlich die **Anzahl**
von *nicht bereits erkannten* TIFF-Namen in folgenden
**gegenseitig ausschließenden** Kategorien:

| Fixer Ergebnisname | Sicheres Interpretationsniveau |
|---|---|
| spectralBandSuffix.G/R/RE/NIR | Name endet mit \`_MS_G/R/RE/NIR.tif(f)\` oder \`-MS-...\` |
| vegetationIndex | Name enthält den abgegrenzten Marker NDVI/NDRE/GNDVI/OSAVI/SAVI/EVI |
| mosaicOrElevation | Name enthält abgegrenzten ORTHO/MOSAIC/ORTHOMOSAIC/DSM/DTM/DEM-Marker |
| other | Kein unterstützter Marker |

Der Bericht erzeugt \`unrecognizedTiffNameHints\`. Die
Kategorien summieren sich immer auf
\`unrecognizedFormats.TIFF\`; sie ersetzen weder
Datei-Inhaltsprüfung noch Georeferenzierung oder
radiometrische Validierung. Insbesondere ist die
Namensendung \`_MS_NIR\` **kein Nachweis eines funktionierenden
NIR-Bilds**. Auch für andere Präfixe (nicht DJI_) wird nie
automatisch M3M-Herkunft behauptet.

Die Pi-Abnahme dieser neuen TIFF-Namenshinweise steht noch aus.
Dafür nach Fast-forward von PR #24 denselben bestehenden
\`--auto-first-page\`-Test wiederholen. Es werden nur
aggregierte Zahlen ausgegeben; der Speicherinhalt,
die Backend-Container und die DJI-Verbindung bleiben unangetastet.

## Neuer Pi-Livetest: maximal 16 Headerbytes pro unbekannter TIFF-Datei

Der reale Pi-Test vom 21.10.2026 bestand **20/20 lokale Tests**.
Die sechs unbekannten TIFF-Dateinamen hatten keine der geprüften
Namensmarkierungen (G/R/RE/NIR, NDVI, Orthomosaik, Höhenmodell).
Der nächste Test prüft deshalb **Dateisignaturen** statt weiterer
Namensmuster.

Neuer Prüfer: `scripts/pi-m3m-tiff-magic-check.js`.
Er liest zunächst einen eindeutig erkannten M3M-verdächtigen Prefix
anhand **nur der ersten 100 Bucket-Einträge**. Dann zählt er die
direkten, bisher nicht erkannten TIFF-Objekte über vollständig
begrenzte S3-Pagination. **Mehr als 12 Kandidaten: Abbruch.**

Für jeden TIFF-Kandidaten wird ausschließlich im bereits
laufenden Backend-Container ein S3 GetObject mit
`Range: bytes=0-15` und vorhandenen Reader-Credentials
ausgeführt. Nur bei **HTTP 206**, gültigem Content-Range
und einer Content-Length von höchstens 16 Bytes werden diese
maximal 16 Bytes auf die vier TIFF-/BigTIFF-Signaturen geprüft.
Bei verweigertem GET wird `unavailable` gezählt; bei
ignoriertem Bytebereich `rangeNotHonored`.
Das bedeutet **keine Freigabe zusätzlicher S3-Rechte**.

Es werden keine TIFF-Verzeichnisblöcke, EXIF, XMP, Koordinaten,
Pixel oder Kalibrierinformationen verarbeitet. Es erscheinen
ausschließlich feste Headerklassen und Summen, niemals die
Dateinamen, Schlüssel, Prefixe oder Bildbytes. Insbesondere
beweist ein korrekter TIFF-Header **keine** DJI-M3M-Herkunft,
Reflektanz, Bandregistrierung oder NDVI-/NDRE-Bereitschaft.
Die betreffenden Flags bleiben `false`.

### Auf dem Pi nur nach Fast-forward ausführen

    cd ~/Projekte/SkyHub-Next || exit 1
    git status --short --branch
    git fetch origin
    git pull --ff-only origin feature/m3m-minio-integration-20261021
    node --test backend/test/m3m-tiff-magic.test.js
    node scripts/pi-m3m-tiff-magic-check.js --help

    # Optional: 16 Headerbytes pro Kandidat lesen, keine Medien ändern
    SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
      node scripts/pi-m3m-tiff-magic-check.js --auto-first-page

Der Prüfer schreibt keine Dateien oder Buckets, ändert keine
Docker-/MinIO-Konfiguration und startet den Backend-Container
nicht neu. Ein GET-Ablehnungsbefund ist kein Schreibfehler.
