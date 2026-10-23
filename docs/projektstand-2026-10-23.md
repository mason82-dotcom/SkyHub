# Projektstand und Integrationsregister – 23.10.2026

> **Stichtag:** 23.10.2026. **Verifizierte Repository-Basis:** [`main`, Commit `4d878314f8345f8cd370f0004916426523e577c0](https://github.com/mason82-dotcom/SkyHub/tree/4d878314f8345f8cd370f0004916426523e577c0), letzter Main-Commit vom **21.10.2026, 17:32:12 UTC**. Die Angaben zu Pull Requests beziehen sich auf den bei Erstellung über GitHub geprüften Stand; sie können später überholt sein. Dieser Bericht ist **keine Pi-Laufzeitabnahme**.

## Statusbegriffe (verbindlich)

- **Main / integriert:** Datei oder Verhalten ist im obigen Main-Commit vorhanden. Das bestätigt weder Deployment noch Hardwarekompatibilität.
- **Im Entwicklungsbranch:** Code liegt in einem GitHub-Branch/PR, **nicht** im Main-Commit. Bei gestapelten PRs darf ein Merge nicht ohne Prüfung der gesamten Basiskette erfolgen.
- **Auf Integrationsbranch gemergt:** PR wurde in `develop/skyhub-integrated-readonly-20261022` übernommen, **nicht** nach `main`.
- **Offline-/CI-validiert:** Synthetische Tests oder isolierte CI können bestanden sein; das ersetzt weder reale DJI-Geräte noch die Überprüfung des Pi-Stacks.
- **Hardwarebeobachtung:** Zeitbezogener Mess-/Protokollbefund; niemals allgemeine Unterstützung für alle Firmwarestände.
- **Freigegeben:** Erst nach Sicherheitsreview, CI, migrationssicherer Abnahme und expliziter Hardware-/Betriebsfreigabe. Für neue Medien-/Analyse-/Flugfunktionen derzeit **nicht** gegeben.

## 1. Was tatsächlich in `main` enthalten ist

| Bereich | Implementierungsstand | Grenzen |
| --- | --- | --- |
| Backend | Node.js 22 in CI, Express 4, Socket.IO, MQTT 5, Redis 7, PostgreSQL/PostGIS; Root-Stack `skyhub-next` | Kein automatischer Pi-Cutover; keine zweite EMQX-Instanz im Root-Compose |
| DJI-Pilot-to-Cloud | Validierte passive `status`-, `osd`-, `state`-, `events`- und `services_reply`-Eingänge; Registry/Topologie; typisierte DJI-1.18-Feldkataloge und M3M-Overlay | Keine vollständige DJI-1.18-Protokollabnahme; fehlende Daten bleiben fehlend |
| Topologie | Optionaler `update_topo` → `status_reply`-Antwortkanal mit **separatem** MQTT-Publisher und ACL; Redis-Topologie-Cache | Standard `SKYHUB_TOPOLOGY_ACK_ENABLED=false`; keine Flugsteuerung |
| Live-Oberfläche | Statisches `frontend/public/index.html` mit Karten-, Geräte-, HMS- und OSD-Frischeanzeige; `pilot-login.html` für HTTPS-Pairing | **Kein** `command-center.html` in Main; UI benötigt für die Karte externe Leaflet-/OSM-Ressourcen |
| REST / Socket.IO | Health; geschützte Geräte, Topologie, Ereignisse, MQTT-/Feld-Diagnose und Telemetrie; historische Tracks; geschützter Pilot-Bootstrap und Pairing; `snapshot` / `device_update` / `device_event` | `POST /api/mission/create` antwortet **501**; keine live gemountete WPML-/Medien-/STS-/KI-API |
| PostGIS | Lesende Track-Historie und schema-gebundene Map-Element-Modelle; isolierte SQL- und Migrations-/Mutations-Tests | Neue Track-Punkte **aus** per `SKYHUB_TRACK_RECORDING_ENABLED=false`; interne Kartenmutationsengine **nicht** gemountet |
| MinIO | Optionales Compose-Profil `media` und persistentes Datenvolumen | In Main **kein** MinIO-Client, keine Medien-HTTP-Endpunkte, kein Pilot-2-Medienupload |
| Python-Worker | Beispiel-/Demonstrationsdateien für Thermal, M3M und M3E | Keine validierte Radiometrie, Orthomosaikberechnung, Vegetationsindexpipeline oder operative Bildanalyse |

**Wichtige Konfigurationsfalle:** `.env.example` nennt `SKYHUB_DJI_MAP_ELEMENTS_ENABLED=false` und `backend/server.js` besitzt eine optional gemountete GET-Route. `docker-compose.yml` auf dieser Main-Basis reicht die Variable **nicht** an den Backend-Container weiter. Ein bloßes Ändern von `.env` aktiviert die Route daher im Root-Compose **nicht**. Keine produktive Freischaltung ohne eigene überprüfte Konfigurationsänderung, erforderliche Datenbankmigration und Autorisierungsprüfung.

**MQTT-Grenze:** Root-Compose erwartet einen **bereits betriebenen** Pi-Broker auf Host-Port **1884**; Backend-Host-Port ist standardmäßig **127.0.0.1:4001**. Weder Compose noch ein GitHub-PR ersetzen den Legacy-Dienst auf Port 4000 automatisch.

## 2. Entwicklung außerhalb von Main (GitHub-PR-Register)

Die Referenzen nennen **PR-Nummern**, nicht Produktreleases. Details/Tests/Lizenzen sind jeweils in PR und Branch-Dokumentation zu prüfen. Status bei Prüfung: `open`, soweit nicht ausdrücklich anders angegeben.

### 2.1 Integrationskette und UI

| PR | Stand | Inhalt / Abhängigkeit |
| --- | --- | --- |
| [#24](https://github.com/mason82-dotcom/SkyHub/pull/24) | offen, **direkt auf Main** | Geschützte lesende MinIO-M3M-Inventur; keine Kalibrierung oder Upload-Pipeline |
| [#28](https://github.com/mason82-dotcom/SkyHub/pull/28) | Draft, auf #24 | TSA/Proxy-Vertrauen und Reconnect-Korrekturen |
| [#29](https://github.com/mason82-dotcom/SkyHub/pull/29) | Draft, auf #28 | `develop/skyhub-integrated-readonly-20261022`: WPML offline, MinIO-Abnahme, RC Plus 2/M4T-Diagnostik |
| [#30](https://github.com/mason82-dotcom/SkyHub/pull/30) | Draft, auf Integrationsbranch | Opt-in-KMZ-Inspektion, **offline**, keine Missionsausführung |
| [#31](https://github.com/mason82-dotcom/SkyHub/pull/31), [#32](https://github.com/mason82-dotcom/SkyHub/pull/32), [#35](https://github.com/mason82-dotcom/SkyHub/pull/35) | **in Integrationsbranch gemergt** | Command Center; Medienseiten-Härtung; isolierte Loopback-Staging-Vorschau. **Nicht in Main** |
| [#41](https://github.com/mason82-dotcom/SkyHub/pull/41), [#42](https://github.com/mason82-dotcom/SkyHub/pull/42) | Drafts, UI-Branch-Kette | Lesende MinIO-Objektansicht und vorläufige Pilot-2-Medienbibliothek, gestapelt auf Command-Center-Entwicklung |

**Integrationsreihenfolge:** Für #29 muss die Vorfahrenkette #24 → #28 → #29 überprüft werden. #30 und UI-PRs hängen von diesem Stand ab. In #31/#32/#35 „merged“ heißt **Merge in den Entwicklungszweig**, nicht automatisch Freigabe für den Raspberry Pi.

### 2.2 Pilot-2-Medien, STS, XMP und Multispektral

| PR | Stand / technische Aussage |
| --- | --- |
| [#19](https://github.com/mason82-dotcom/SkyHub/pull/19), [#23](https://github.com/mason82-dotcom/SkyHub/pull/23), [#25](https://github.com/mason82-dotcom/SkyHub/pull/25) | Offene, teilweise überlappende MinIO-/M3M-/Backup-Themen. Vor Integration Duplikate gegen #24 und #29 abgleichen |
| [#33](https://github.com/mason82-dotcom/SkyHub/pull/33) | Geprüfter passiver `services_reply`-Vertrag im Entwicklungsbranch; nicht Main |
| [#34](https://github.com/mason82-dotcom/SkyHub/pull/34) → [#36](https://github.com/mason82-dotcom/SkyHub/pull/36) → [#37](https://github.com/mason82-dotcom/SkyHub/pull/37) → [#38](https://github.com/mason82-dotcom/SkyHub/pull/38) | Gestapelte **Drafts**: HTTPS-Pilot-STS-Vertrag, begrenzter MinIO-STS-Issuer, HEAD-geprüfte Registrierung und getrennte Pilot-2-HTTPS-Medien-API. Keine produktive Router-Montage/Deployment-Freigabe |
| [#39](https://github.com/mason82-dotcom/SkyHub/pull/39) | Draft auf #38: workspacegebundene, auditierbare lesende Medienbibliothek; Dateinamen-Gruppierung ≠ radiometrischer Nachweis |
| [#40](https://github.com/mason82-dotcom/SkyHub/pull/40) | Draft auf #39: eng begrenzte bedingte TIFF-/XMP-Range-Leseproben. XMP-Werte sind **nicht** durch Kalibrierung bestätigt; keine sichere allgemeine Bildparser-Sandbox |
| [#48](https://github.com/mason82-dotcom/SkyHub/pull/48) | Draft auf #40: experimentelle **offline**-Rasterindizes (NDVI, NDRE, GNDVI, OSAVI) aus **bereits extern kalibrierten und exakt registrierten** Float-Reflexionsrastern; kein DN→Reflexion, keine freigegebene M3M-Produktionspipeline |
| [#51](https://github.com/mason82-dotcom/SkyHub/pull/51) | Draft auf #48: streng begrenzter **offline**-TIFF-Pixel-/XMP-Capture-Audit an lokalen uint16-Bildern; nur aggregierte Zähler, keine echte M3M-Datei geprüft, keine Bandkalibrierung/Registrierung oder Indexbereitschaft |

**DJI-Mediendatenfluss:** Pilot 2 verwendet die **HTTPS-/STS- und S3-Speicherstrecke**, nicht die MQTT-OSD-Subscription als Dateiübertragungsweg. Kein Entwurf darf Filename-Zählungen, HEAD/ETag, TIFF/XMP-Hinweise oder synthetische Indextests als belegte Reflexionskalibrierung, Bandregistrierung oder realweltlich geprüfte NDVI-/NDRE-Karte ausgeben.

### 2.3 DJI-Geräte, WPML, externe Referenzen und KI

| PR | Stand / technische Aussage |
| --- | --- |
| [#18](https://github.com/mason82-dotcom/SkyHub/pull/18), [#21](https://github.com/mason82-dotcom/SkyHub/pull/21), [#22](https://github.com/mason82-dotcom/SkyHub/pull/22), [#26](https://github.com/mason82-dotcom/SkyHub/pull/26), [#27](https://github.com/mason82-dotcom/SkyHub/pull/27) | Offene Gerätediagnose-/Hardware-Evidenzzweige: RC Plus 2/M4T, M3M-OSD/Capability-Gaps und Validierungsfixes. **Nicht pauschal Main-Funktionalität** |
| [#16](https://github.com/mason82-dotcom/SkyHub/pull/16), [#44](https://github.com/mason82-dotcom/SkyHub/pull/44) | Gestapelte WPML-/KMZ-Offline-Tests und externe DJI-Referenzanalyse; kein produktives Wayline-Deployment |
| [#43](https://github.com/mason82-dotcom/SkyHub/pull/43) | Draft auf #40: Opt-in-**RGB**-YOLO11-Worker für lokale Bilder und kontrollierte Modelle; kein Livestream, keine DJI-Cloud-API-Integration |
| [#45](https://github.com/mason82-dotcom/SkyHub/pull/45) → [#49](https://github.com/mason82-dotcom/SkyHub/pull/49) | Gestapelte Drafts auf #43: Offline-Thermal-Pixel→GPS-*Kandidaten* und lokale HMAC-Provenienz; ohne verifizierte Kamera-/Geländekalibrierung, Personenbestätigung oder SAR-Einsatzfreigabe |
| [#50](https://github.com/mason82-dotcom/SkyHub/pull/50) → [#52](https://github.com/mason82-dotcom/SkyHub/pull/52) | Drafts auf #49: manuell gepinntes M3T/M4T-Kalibrierungsprofil und zweifach HMAC-gebundene Offline-Quellmedien; nur begrenzte **JPEG/XMP-Feldpräsenz**, keine Metadatenwerte, DJI-Sensorherkunft, Gimbal-/AGL-Verifikation oder GPS-Eignung |
| [#46](https://github.com/mason82-dotcom/SkyHub/pull/46) | Draft direkt auf Main: getrenntes HiveMind-Simulationslabor; **synthetische** Pilot- und Dock-MQTT-E2E-Läufe in isolierter GitHub-CI bestanden ([Runtime #39894401436](https://github.com/mason82-dotcom/SkyHub/actions/runs/39894401436)); Dock-RPCs nur per Lab-Mock. Upstream SDK 1.16.1.3, daher **kein** Beweis für DJI Cloud API 1.18 oder echte DJI-Hardware |
| [#47](https://github.com/mason82-dotcom/SkyHub/pull/47) | Draft direkt auf Main: rein synthetischer Offline-Protokoll-Paritätsaudit gegen gepinnte SDK-1.18-Referenz; kein realer Geräte-/Dock-Test |

**Zusatz:** Die drei in Main gemergten Grundlagen [#15](https://github.com/mason82-dotcom/SkyHub/pull/15) (DJI-Feldkatalog), [#17](https://github.com/mason82-dotcom/SkyHub/pull/17) (RC Pro/M3M-Diagnose) und [#20](https://github.com/mason82-dotcom/SkyHub/pull/20) (modellbezogene M3M-OSD-Erweiterung) sind von den oben genannten offenen Ergänzungen zu unterscheiden.

## 3. Bekannte Main-Lücken, die nicht als Feature zählen

- **DJI-Modell-Diagnose: Regression in Main.** In `backend/server.js` nutzt die Validierung von
  `GET /api/diagnostics/dji-fields?model=0:77:2` ein Regex-Literal mit
  **doppelt maskiertem `\\d`** und weist dadurch reguläre numerische
  Modellschlüssel mit HTTP 400 zurück. Ein konkreter Fix samt Regressionstests
  liegt in [PR #26](https://github.com/mason82-dotcom/SkyHub/pull/26), aber
  **nicht in Main**. Vor Nutzung der Route muss der Fix integriert und geprüft werden.
- **DJI-Kartengruppen-Flag:** `.env.example` nennt die Flag, Root-Compose reicht sie
  jedoch nicht durch; dies ist kein dokumentierter sofort aktivierbarer API-Schalter.
- **Gesamtintegration:** Offene gestapelte Medien-/Analyse-PRs haben teilweise
  eigene Backend-Router und Worker. **Existenz einer Datei in einem PR ist
  kein Nachweis einer Runtime-Montage oder einer erfolgreichen Hardwareabnahme.**

## 4. Hardware- und Testevidenz

- **20.–21.10.2026, RC Pro Enterprise + Mavic 3M:** MQTT-Topologie/OSD und modellbezogene Aircraft-Rootfelder wurden am echten Gerät beobachtet; Einzelheiten in [Hardwareabnahme](hardware-rc-pro-m3m.md). Die M3M-Overlay-Definitionen sind teilweise vorläufig. „Nicht beobachtet“ bedeutet nicht „Hardware defekt“; Kamerafunktionen und nicht passende Aircraft-Feldpfade dürfen nicht zusammengezählt werden.
- **RC Plus 2 + Matrice 4T:** getrennte Entwicklungs-/Abnahmebelege im offenen [#18](https://github.com/mason82-dotcom/SkyHub/pull/18), nicht als allgemeine 1.18-Konformität oder bereits gemergter Main-Support ausgeben.
- **GitHub Actions:** Die Main-Konfiguration definiert Node-/Python-Prüfungen sowie isolierte PostGIS-Integration und isolierten Dump-/Restore-Test. Grün gemeldete CI einzelner PR-Commits betrifft **genau diese Commits**; nach Änderungen ist der jeweilige neue Head erneut zu prüfen.
- **Standort / Zeit:** `telemetryFieldAt` und `telemetryFieldTimeVerified` sind nur Live-Snapshot-Metadaten; sie werden nicht in den Redis-Gerätecache kopiert. Ein gültiges Koordinatenpaar benötigt denselben OSD-Eingang; `(0,0)` begründet keinen gültigen Standort.
- **Flug-/Agrarfunktionen:** Keine Test-/CI-Meldung ist eine Fluggenehmigung, agronomische Diagnose, thermische Personenerkennung oder Kalibrierungszertifizierung.

## 5. Freigabegates und nächste sichere Integrationsschritte

1. **Baseline festhalten:** `git status`, `git rev-parse HEAD` und tatsächliche Pi-Container/Ports separat aufnehmen. Branch-Komponenten nicht als Main-Funktionen dokumentieren.
2. **Offene Ketten konsolidieren:** #24/#28/#29, danach nur benötigte UI-/WPML- und Pilot-Medien-Teilzweige. Doppelte MinIO-/M3M-Implementierungen in #19/#23/#25 vorab auflösen. Keine gestapelten PRs wahllos nach Main mergen.
3. **Vertrags- und Security-Abnahme:** Auth, HTTPS-Proxy-Vertrauen, Publisher-ACL, Workspace-/STS-Trennung, Token-/Audit-Redaktion, S3-Get-only/Put-Grenzen, No-write-Flugschutz und rückwärtskompatible Migrationen prüfen.
4. **CI pro finalem Integrationscommit:** Node-Tests, Python-Tests, PostgreSQL-Migration/Restore und nur isolierte MinIO-/Simulator-Labs; reproduzierbare Ergebnisse auf GitHub verlinken.
5. **Separate Pi-Abnahme:** Sicherung, Preflight, expliziter Rollbackpfad, nur freigegebenes Backend-Update; **kein** Docker-`down -v`, kein unkontrollierter Legacy-Stack-Start, kein reales MinIO-Restore als Test.
6. **M3M-Messwertgüte vor Smart Farming:** reale vollständige 5-Band-Aufnahmen, Herkunft/Metadaten, DN→Reflexion, Kalibrierung, Bandregistrierung, Maskierung, geographischer Bezug, Referenzflächen, QA und nachvollziehbarer Export. Erst danach operationelle NDVI-/NDRE-Karten oder Agronomie-Funktionen erwägen.
7. **Thermal / YOLO / WPML:** Lizenzen, Modellherkunft, reale Kamera- und Gimbalmetadaten, Ground-Truth, sichere Offline-Prozesse und getrennte DJI-1.18-End-to-End-Abnahmen vor Live-Integration.

## 6. Nachtrag zur Konsolidierung (23.10.2026)

Seit dieser ersten Momentaufnahme sind drei weitere offene Drafts hinzugekommen:
[#54](https://github.com/mason82-dotcom/SkyHub/pull/54) (offline MP4/MOV-/SRT-Zeitstrukturen),
[#55](https://github.com/mason82-dotcom/SkyHub/pull/55) (extern vorbereitetes DEDAL/ODM-Orthomosaik-Handoff)
und [#56](https://github.com/mason82-dotcom/SkyHub/pull/56) (relative MP4-Sample-DTS/PTS).
**Keines** ist in Main oder auf dem Pi integriert; die Versuche beweisen keine
reale DJI-Video-/UTC-Synchronisation, Reflexionskalibrierung oder operative
Karten-/SAR-Bereitschaft.

Die vollständige **Merge-Reihenfolge, Basiskette und Review-Gates** stehen im
[priorisierten Integrationsplan](integration-priorities-2026-10-23.md).
Insbesondere ist der sehr umfangreiche [#24](https://github.com/mason82-dotcom/SkyHub/pull/24)
kein sicherer pauschaler Merge-Kandidat.

## 7. Nützliche Dokumente und verbindliche Trennlinien

- [README](../README.md) – Startpunkt und Root-/Legacy-Grenze
- [Architektur](architecture.md) und [Sicherheitsmodell](security.md) – **nur Main** als Runtime-Vertrag
- [Konfigurationsreferenz](config-reference.md) und [API-Vertrag](api-reference.md) – Env-/Compose-Weitergabe, Endpunkt-/Token-/LAN-Grenzen
- [Betrieb](ops.md), [Skriptwirkungen](scripts.md), [Legacy-Takeover](skyhub-legacy-takeover.md) – keine stillen Änderungen am Pi
- [DJI-Feldprüfung](dji-118-field-audit.md), [Hardware RC Pro/M3M](hardware-rc-pro-m3m.md), [DJI-Kompatibilität](dji-cloud-api-compatibility.md)
- [Historischer Entwicklungsplan vom 20.10.2026](entwicklungsplan-2026-10-20.md) – **historischer Ausgangspunkt**, keine Live-Roadmap für alle offenen PRs

**Aktualisierungsregel:** Bei Merge nach Main diese Übersicht anhand eines **neuen Main-SHA** und des tatsächlichen Dateibaums neu bewerten. Ein GitHub-PR-Merge ändert weder automatisch laufende Container noch die Pi-Hardwareabnahme.