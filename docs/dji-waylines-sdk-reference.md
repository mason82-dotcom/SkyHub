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
