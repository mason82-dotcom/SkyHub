# Motecshine DJI Waylines SDK als SkyHub-Next-Referenz

**Status: Offline-Referenzintegration; nicht flugfreigegeben.** Kein DJI-Cloud-API-Missionsversand, kein MQTT-Publish, kein Upload auf Drohnen oder RC, kein automatisches Flight-Ready-Signal.

## Herkunft / Stand

- Quellrepository: https://github.com/motecshine/dji-waylines-sdk
- geprüfter Upstream-Commit: `dd9b12d26c4c200220165e8e6d409d6dafdbfa23` (README zuletzt 09.10.2025)
- einsehbare Go-Bausteine: `converter_schema.go`, `converter.go`, `validator.go`, `actions.go`, `action_types.go`, `structures.go`, `serializer.go`, `kmz.go`
- Go-Modul in `go.mod`: `github.com/motecshine/dji-waylines` (Go 1.25.1). **README empfiehlt dagegen `github.com/motecshine/wpml`**. Nicht ungeprüft übernehmen.
- **Lizenzklärung offen:** Die README nennt MIT, aber im eingesehenen Repository-Tree ist **keine LICENSE-Datei** vorhanden. Es wird deshalb weder Drittquellcode kopiert noch das Go-Modul zur SkyHub-Abhängigkeit gemacht.

Das Go-SDK ist eine **zusätzliche Vergleichsreferenz**, keine kanonische DJI-WPML-Spezifikation und kein DJI-Zertifizierungsnachweis. DJI-WPML-Dokumentation und an DJI Pilot 2 erzeugte KMZ haben bei fachlichen Entscheidungen Vorrang. Der Upstream-Namespace von `NewDocument()` ist `1.0.6`, der bestehende SkyHub-Editor schreibt `1.0.2`; dies wird nicht ohne Schema- und Pilot-2-Prüfung global umgestellt.

## Technischer Befund und Abgrenzung

| Bereich | Befund | Entscheidung |
|---|---|---|
| Missionsobjekt | `Waylines` mit numerischen `drone_model`/`payload_model`, Speed, Height, Waypoints | Strikt begrenztes JSON-Importprofil |
| DJI-Profil | `converter.go` setzt `DroneSubEnumValue: 0` fest, obwohl Modelle Untervarianten benötigen | **Nicht übernehmen**; SkyHub nimmt eigene explizite Geräte- und Payload-Matrix |
| README-Beispiele | teils String-IDs wie `M3TD` und camelCase-Aktionsparameter | Nur dokumentierte Aliase für Payload-Index, keine heuristische Gerätezuordnung |
| Geodäsie | Go-Struktur kennt EGM96/AGL/Folgeverfahren; SkyHub benötigt überprüfbare Höhenbezüge | Import nur `relativeToStartPoint`, nur konstante Höhe |
| Aktionsgruppen | Go unterstützt weitere Action-Typen und Trigger | JSON-Import nur maximal ein `takePhoto` je Wegpunkt bei `reachPoint` und Payload 0 |
| RC-Loss | Go-Konverter: `goContinue` mit `hover`; SkyHub-Generator: `executeLostAction` mit `goBack` | Nicht als semantisch äquivalent ausgeben; DJI-/Betriebsprüfung nötig |
| KMZ | Go: Erzeugen/Parsen, SkyHub: eigener begrenzter ZIP-/XML-Validator | Bereits vorhandene SkyHub-Pipeline bleibt maßgeblich |
| Mavic 3M | SkyHub verfügt über M3M-Profil; Upstream-Enum-Liste belegt keine identische M3M-Kombination | M3M bleibt im nativen SkyHub-Editor, **nicht** freigeben für diesen SDK-JSON-Import |
| DJI Cloud API | Die Go-Bibliothek ist primär WPML-/Datei-Tooling | Keine neue API-Route, kein Remote-Missionsdispatch |

## Implementiert

- `frontend/public/wpml-waylines-reference.js`: unabhängiger, browser-/Node-kompatibler Adapter `convert(input)` und vorgeschalteter `parseJson(raw)`-Dateileser. Unterstützt ausschließlich kleine, eindeutig übertragbare `Waylines`-JSON-Entwürfe. Doppelte JSON-Schlüssel – auch durch Unicode-Escapes verdeckte und verschachtelte – sowie übertiefe Dokumente werden **abgewiesen**. Unbekannte Felder, Aktionsparameter, heterogene Wegpunkthöhen, abweichende Geschwindigkeiten und unbekannte Drohnen-/Payload-Kombinationen werden ebenfalls **abgewiesen**.
- `frontend/public/wpml-editor.html` / `wpml-editor.js`: Dateiimport ausschließlich im Browser (JSON, max. 128 KiB); kein Upload. Nach Adapterprüfung und `SkyHubWpmlPlanner.normalize()` erscheint **zuerst eine Vorschau**. Der aktive Missionsentwurf wird **nur nach gesondertem Übernahme-Klick** geändert; bei bereits gesetzten Wegpunkten ist zusätzlich eine Bestätigung erforderlich. Abbrechen, ungültige Dateien und Ablehnung erhalten den alten Entwurf. Das KMZ wird weiterhin durch den **existierenden** SkyHub-Kern generiert.
- Die Vorschau enthält Anzahl der Wegpunkte/Fotoaktionen, horizontale Segmentstrecke per sphärischer Haversine-Näherung und eine **rein nominelle** Zeit `Strecke / Sollgeschwindigkeit`. Sie ist weder tatsächliche Flugzeit noch Batteriekalkulation. Nicht berücksichtigt sind Steigflug, Kurven, Wind, Gelände, Hindernisse oder Luftraumbeschränkungen.
- `backend/test/wpml-waylines-reference.test.js`: Profilzuordnung, Offline-KMZ und Validator, ungültige und verlustbehaftete Eingaben, Editor-Anbindung und Sicherung gegen eine Mission-API.
- `backend/test/wpml-reference-editor-ui.test.js`: Headless-UI-Test für Staging/Vorschau, explizite Übernahme, Abbruch, Fehlerfälle und Bestätigung vor Überschreiben.

Erlaubte Profilpaare (numerische DJI-Enum-IDs aus dem eingesehenen Upstream-Typkatalog und SkyHub-Profilmatrix):

| `drone_model` | `payload_model` | SkyHub |
|---:|---:|---|
| 77 | 66 | Mavic 3E |
| 77 | 67 | Mavic 3T |
| 99 | 88 | Matrice 4E |
| 99 | 89 | Matrice 4T |

Zulässiger JSON-Eingang: `name` (max. 70 Zeichen), `drone_model`, `payload_model`, optional `payload_position_index=0`, `template_type="waypoint"`, `global_speed` (1–15), optional `global_height` (muss mit allen Höhen übereinstimmen), optional `safe_height` (20–120, sonst Go-Default 20), optional `height_type="relativeToStartPoint"`, optional `finish_action="goHome"|"noAction"`, zwei bis 500 `waypoints` mit `latitude`, `longitude`, identischer `height` (5–120 m), optional passender `speed` und einem `takePhoto`-Action-Objekt pro Wegpunkt. `params` oder `action` darf den Payload-Index 0 enthalten. Zusatzparameter, einschließlich `global_rth_height`, werden abgewiesen, **nicht** stillschweigend weggelassen.

### Synthetischer Beispielimport

```json
{
  "name": "Waylines Referenz – Demo",
  "drone_model": 77,
  "payload_model": 66,
  "template_type": "waypoint",
  "global_speed": 5,
  "global_height": 50,
  "safe_height": 30,
  "height_type": "relativeToStartPoint",
  "waypoints": [
    {"latitude": 49.1, "longitude": 8.6, "height": 50, "actions": [
      {"type": "takePhoto", "params": {"payload_position_index": 0}}
    ]},
    {"latitude": 49.101, "longitude": 8.601, "height": 50}
  ]
}
```

Editor öffnen: `/wpml-editor.html`; lokale JSON-Datei auswählen, **Vorschau prüfen und ausdrücklich übernehmen**; anschließend den Entwurf auf der Karte überprüfen und nur als Offline-KMZ ausgeben.

> **Kein Roundtrip-Versprechen:** Dieses JSON wird nicht durch die Go-Bibliothek ausgeführt. Der SkyHub-Export besitzt eigene Sicherheitsvorgaben, insbesondere zur RC-Verlustreaktion. Strukturell valide KMZ ist nicht automatisch auf DJI Pilot 2 importierbar, und selbst erfolgreicher Import ist keine Flugfreigabe.

## Tests und weitere Abnahme

```bash
node --check frontend/public/wpml-waylines-reference.js
node --check frontend/public/wpml-editor.js
node --test backend/test/wpml-waylines-reference.test.js backend/test/wpml-reference-editor-ui.test.js
node --test backend/test/wpml-editor.test.js backend/test/wpml-compare.test.js
```

Die neue Änderung ist isoliert im Entwicklungsbranch; kein Pi-Deployment. Als nächste **separate** Schritte: Lizenz/Go-Modulpfad upstream klären, die synthetische JSON-/KMZ-Parität anhand anonymisierter DJI-Pilot-2-Exporte testen, Submodelle und RC-Loss-Verhalten pro Firmware verifizieren und erst danach mögliche Mapping-, Trigger- oder Multispektral-Erweiterungen prüfen. Hardware-Validierungsstatus muss bis dahin `false` bleiben.

## Offline-Referenz-Risikoaudit für vorhandene KMZ (Phase 4)

`backend/wpml-reference-audit.js` stellt `auditReferenceKmz(buffer)` bereit. Die CLI
`scripts/wpml-reference-audit.js` liest eine KMZ **rein lokal und nur lesend**:

```bash
node scripts/wpml-reference-audit.js /pfad/zu/einer-lokalen-mission.kmz
```

**Rückgabecodes:** `0` bedeutet *keine der explizit bekannten Referenz-Divergenzen gefunden*, **nicht** flugtauglich; `1` bedeutet Review notwendig; `2` bedeutet blockiert/ungültige Datei/Einlesefehler. Der JSON-Report enthält ausschließlich feste Fehlerkennungen und Statuswerte, **niemals XML-Werte, GPS-Koordinaten, Dateipfade, Missionsnamen oder einzelne Höhenwerte**. Die Funktion ist kein DJI-Importvalidator und kein tatsächlicher Lauf des Go-SDK.

Referenz auf Upstream-Commit `dd9b12d...` und die DJI-Dokumentation:
- [DJI `template.kml` / Sicherheits- und Höhenfelder](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/template-kml.html)
- [DJI `waylines.wpml` / Flugkommandos und Verlust der RC-Verbindung](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/waylines-wpml.html)

Erkannte Abweichungen, die **nur eine fachliche Warnung**, keine automatisierte Korrektur auslösen:

| Risikocode | Bedeutung |
|---|---|
| `RC_LOSS_POLICY_DIFFERS_FROM_SKYHUB_EDITOR` | Vorgabe bei RC-Signalverlust weicht von SkyHubs aktuellem Offline-Editor ab; die DJI-Feldwerte sind nicht grundsätzlich verboten |
| `TAKEOFF_REFERENCE_REQUIRES_INDEPENDENT_PROVENANCE` | `takeOffRefPoint` vorhanden; die Quelle und die tatsächliche WGS84-Ellipsoidhöhe des Referenzpunkts sind gesondert zu prüfen |
| `TAKEOFF_AGL_ZERO_REQUIRES_REVIEW` | SDK-Konverter erzeugt für die automatisch angenommene Referenz ggf. AGL-Höhe `0`; nicht als verifizierter Bodenabstand behandeln |
| `ELLIPSOID_HEIGHT_PROVENANCE_UNVERIFIED` | Ein `ellipsoidHeight`-Feld existiert; der Höhenbezug ist nicht extern verifiziert |
| `ELLIPSOID_EQUALS_OTHER_HEIGHT_REQUIRES_REVIEW` | Numerisch gleiche Höhen in zwei Referenzsystemen; das ist **nicht zwangsläufig falsch**, verlangt aber bei der SDK-Konvertierung einen Herkunftsnachweis |
| `WAYLINE_STATS_NOT_INDEPENDENTLY_VERIFIED` | `distance`/`duration` im KMZ; die Upstream-Schätzung rechnet mit ca. 111.000 m je Breiten- **und** Längengrad, was von der geografischen Breite und Route abhängige Fehler auslösen kann |

Blockierende Befunde sind u. a. `AIRCRAFT_SUBTYPE_PAYLOAD_CONFLICT`, `AIRCRAFT_SUBTYPE_UNRECOGNIZED`, `WPML_OFFLINE_VALIDATION_FAILED` und `WPML_NAMESPACE_NOT_VALIDATED_BY_SKYHUB`. Insbesondere verwendet der Upstream `NewDocument()` den Namespace `1.0.6`, während der aktuell gepinnte SkyHub-WPML-Parser nur `1.0.2` prüft. **Der Audit untersucht `1.0.6` ausschließlich über eine temporäre In-Memory-Namespace-Umetikettierung für einen zusätzlichen lesenden Strukturcheck. Das Original wird nicht verändert oder neu exportiert; der Prüfstatus bleibt immer `blocked` und `offlineValid:null`.** Dies bestätigt ausdrücklich **keine** DJI-Pilot-2-Kompatibilität. Unbekannte oder gemischte Namespaces werden ebenfalls blockiert.

Geprüft werden beide XML-Dokumente innerhalb einer durch SkyHub größen- und CRC-begrenzten KMZ. Das Tool erzeugt **keine** Flugroute, sendet **keine** DJI-Kommandos und liest keine Kamera-/Ressourceninhalte. Auch ein unauffälliger Audit besitzt `flightReady:false`, `pilot2HardwareVerified:false` und `sdkOutputVerified:false`.

Tests: `node --test backend/test/wpml-reference-audit.test.js`.

## Reproduzierbare synthetische WPML-Kompatibilitätsmatrix (Phase 5)

**Ziel:** bekannte Quellcode-Abweichungen über alle fünf SkyHub-Profile reproduzierbar sichtbar machen, ohne Go-Binärdateien, private Missionen, Pilot 2 oder Hardware zu benötigen.

```bash
node scripts/wpml-reference-matrix.js
node --test backend/test/wpml-reference-matrix.test.js
```

Der Generator `backend/wpml-reference-matrix.js` erzeugt **30 lokale synthetische In-Memory-KMZ-Prüffälle**: fünf Modelle (Mavic 3E, Mavic 3T, Mavic 3M, Matrice 4E, Matrice 4T) mal sechs Szenarien. Die Fälle modellieren SkyHub-Basisexport, Go-artige RC-Loss-Einstellungen, die Upstream-Subtyp-Nullsetzung, gleiche relative/Ellipsoidhöhe, die grobe Grad-zu-Meter-Distanzschätzung und den Upstream-Namespace `1.0.6`.

Die Statuscodes sind:
- `no-listed-divergence-observed`: keine der **explizit** kodierten Auffälligkeiten in diesem künstlichen Datensatz;
- `review-required`: mindestens ein bekannter fachlicher Reviewpunkt, keine automatische Korrektur;
- `blocked`: Profil-/Schema-/Versionskonflikt oder andere blockierende Validierung.

**Evidenzgrenze:** Das CLI erzeugt ausschließlich synthetische SkyHub-KMZ mit gezielten XML-Mutationen. Weder Go-SDK-Code noch DJI Pilot 2 werden in diesem Test ausgeführt. Die beiden booleschen Felder `actualGoSdkExecutableRun:false` und `actualPilot2ImportTest:false` verhindern eine Verwechslung mit echten Fremdhersteller- oder Hardwaretests. Besonders die Mavic 3M ist kein freigegebenes Go-JSON-Importprofil, selbst wenn SkyHub einen eigenen Offline-WPML-Generator besitzt.

Der zusätzlich lesende Prüfer kann nun auch `1.0.6`-KMZ nach den **inhaltlichen** Go-SDK-typischen Risikomustern untersuchen. Das erfolgt ausschließlich in-memory; die archivierte Version bleibt unverändert und ihr Abnahmestatus bleibt blockiert. Ein grober Haversine-Vergleich markiert starke Abweichungen zwischen der im XML notierten `distance` und der horizontalen Segmentstrecke als `WAYLINE_DISTANCE_DIFFERS_FROM_SPHERICAL_APPROXIMATION`. Es werden keine Strecken-, Koordinaten- oder sonstigen Rohwerte ausgegeben. Diese Distanzprüfung ist **keine** Flugzeit-, Gelände- oder Energieberechnung.

### Echte Referenzen einbringen – ausschließlich offline

Die realen Vergleichsdateien werden **nicht erfunden** und nicht in Git eingecheckt. Nach rechtmäßiger Bereitstellung durch den Operator können ein tatsächlicher Go-SDK-Export und ein DJI-Pilot-2-Export lokal analysiert werden:

```bash
node scripts/wpml-reference-audit.js /lokaler/pfad/go-sdk.kmz
node scripts/wpml-reference-audit.js /lokaler/pfad/pilot2.kmz
node scripts/wpml-compare.js /lokaler/pfad/skyhub.kmz /lokaler/pfad/pilot2.kmz
```

Der Vergleich verwendet bestehende Privacy-Redaction und ist nur für vom aktuellen Parser akzeptierte Namespace-Versionen aussagekräftig; für `1.0.6` zunächst den separaten Risikoprüfer verwenden. Ein echter Pilot-2-Import, einschließlich Firmware- und Gerätekennung, bedarf einer **separaten, dokumentierten Hardwareabnahme**. Selbst dabei darf `flightReady:false` nicht implizit aufgehoben werden.

## Lokaler Evidenzvergleich für tatsächlich bereitgestellte Referenz-KMZ (Phase 6)

`backend/wpml-reference-evidence.js` und `scripts/wpml-reference-evidence.js` verbinden die bisherigen einzelnen Offline-Audits und den strukturellen KMZ-Vergleich in einem reproduzierbaren Ablauf. **Weder Dateien noch Manifeste werden an einen Server übertragen.** Es wird keine echte Referenzdatei automatisch heruntergeladen, kein Go-SDK ausgeführt und kein DJI-Pilot-2-Import behauptet.

### Beispiel für ein lokales Manifest

Erstelle im Repositoryverzeichnis einen vom Git ignorierten Ordner `.local-wpml-evidence/` und lege **nur lokal** folgende Datei `references.json` an:

```json
{
  "schema": "skyhub-wpml-reference-fixtures-v1",
  "files": {
    "skyhub": "skyhub.kmz",
    "goSdk": "go-sdk.kmz",
    "pilot2": "pilot2.kmz"
  }
}
```

Die KMZ-Dateien müssen im selben Verzeichnis oder in dessen Unterordnern liegen. Mindestens **zwei** der drei kontrollierten Rollen sind nötig, die dritte ist optional. Nur lokale, reguläre Dateien sind zulässig; Symlinks, absolute Pfade, `..`-Pfadbestandteile, zusätzliche Manifestfelder und Dateien außerhalb des Manifestverzeichnisses werden abgewiesen. Ein fehlender oder beschädigter Import erzeugt **keine** Rohdaten- oder Pfadfehlerausgabe.

```bash
node scripts/wpml-reference-evidence.js .local-wpml-evidence/references.json
node --test backend/test/wpml-reference-evidence.test.js
```

**Rückgabewerte:** `0` = keine der expliziten Befunde und kein struktureller Unterschied gefunden; `1` = fachlicher Review notwendig, einschließlich abweichender KMZ oder byteidentischer angeblich unterschiedlicher Quellen; `2` = blockierter/ungültiger/untereinander nicht vergleichbarer Eingang. Auch `0` bestätigt **weder Dateiauthentizität noch DJI-Importfähigkeit**.

Das Werkzeug prüft die einzelnen Dateien mit `auditReferenceKmz()` und vergleicht alle vorhandenen Rollen paarweise mit `compareKmz()`, jedoch **nur wenn beide KMZ innerhalb des nativ unterstützten SkyHub-Namespaces `1.0.2` offline-valide sind**. Dateien mit `1.0.6` werden zwar innerhalb des separaten lesenden Audits untersucht, der semantisch nicht verlässliche Cross-Namespace-Vergleich bleibt jedoch als `skipped-noncomparable-or-blocked` gekennzeichnet. Es gibt **keine** automatische Namespace-Konvertierung als Flugmission.

Der strukturierte JSON-Bericht enthält nur vordefinierte Rollen, Kategorien, Befunde, boolesche Prüffelder und Aggregatzahlen. **Keine** GPS-Koordinaten, Missionsnamen, Dateinamen, Pfade, Roh-XML, KMZ-Bytes oder SHA-Fingerprints werden ausgegeben. Die Rollen `goSdk` und `pilot2` sind **unbestätigte Bedienerangaben**. Insbesondere müssen `actualGoSdkExecutableRun:false`, `actualPilot2ImportTest:false`, `pilot2HardwareVerified:false` und `flightReady:false` bleiben.

Für eine spätere echte DJI-Hardwareabnahme ist eine getrennte, nachvollziehbar dokumentierte Prüfung von Fluggerät, Firmware, DJI Pilot 2, Kameraaktionen und Höhenbezügen erforderlich. Ein paarweiser XML-Vergleich – selbst bei Gleichheit – ist kein Nachweis für Hardwarekompatibilität oder sicheren Flug.
