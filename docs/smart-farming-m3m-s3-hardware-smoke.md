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
