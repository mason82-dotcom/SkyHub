# Integrationsstrategie und Merge-Gates für SkyHub Next

**Repository-Abgleich:** 23.10.2026 (GitHub-Prüfung). **Codebasis (fortgeschrieben am 23.10.2026):** `main` @ `496a1f84f22b15f85ad5442965b2cd218a93969a`. Die PR-Stände sind eine datierte Momentaufnahme, keine automatische Live-Synchronisierung. [Projektstatus](projektstand-2026-10-23.md) · [API-Vertrag](api-reference.md) · [Sicherheitsmodell](security.md).

## 1. Verbindliche Entscheidung

**Keine Massenmerges und kein automatisches Raspberry-Pi-Deployment.** Mehrere PRs basieren auf **anderen offenen PR-Branches**. Bei einem GitHub-Merge von gestapelten PRs kann die Basishistorie mehr Dateien enthalten als der einzelne PR-Diff. Die Basis muss vor jedem Merge anhand des exakten Commits und aller abhängigen PRs erneut kontrolliert werden.

Unterscheiden:

1. **Main integriert:** Änderungen wurden nach `main` gemergt, nicht notwendigerweise auf dem Pi bereitgestellt.
2. **Entwicklungs-PR, Base = main:** nur ein Kandidat für einen isolierten Review; noch keine Betriebsfreigabe.
3. **Gestapelter PR:** nur der eigene Diff ist als Featureabgrenzung aussagekräftig; der Parent-Branch kann umfangreichen ungemergten Code enthalten.
4. **In `develop/skyhub-integrated-readonly-20261022` gemergt:** Teil dieser **nicht nach Main gemergten** Integrationslinie.
5. **CI-/Simulator-Abnahme:** Beweis für *genau die geprüfte Revision und Prüfbedingungen*, nicht für echte DJI-1.18-Hardware, Kalibrierung, Sicherheit im Einsatz oder Flugfreigabe.

## 2. Priorisierte Reihenfolge

| Stufe | Kandidat | Quellstatus / Umfang | Aufnahmebedingung | Empfehlung |
| --- | --- | --- | --- | --- |
| **Erledigt** | [#61 – DJI-Feld-Diagnose-Regex](https://github.com/mason82-dotcom/SkyHub/pull/61) | Aus altem [#26](https://github.com/mason82-dotcom/SkyHub/pull/26) isoliert, inzwischen in Main gemergt | Alle sechs Modellkennungen, 400/404 und View-Token-/LAN-Negativtests über CI abgenommen | Kein Pi-Deployment; alter #26 darf **nicht** zusätzlich blind gemergt werden |
| **Erledigt** | [#47 – DJI 1.18 Offline-Protokollabgleich](https://github.com/mason82-dotcom/SkyHub/pull/47) | Fünf isolierte Dateien in Main gemergt; 16 synthetische Fixtures | Pinned SDK-Referenz, kein Live-MQTT, CI erfolgreich | **Nur Offline-Regressionsnachweis**, keine echte DJI-1.18-Gerätezertifizierung |
| **P1** | [#27 – gemeinsame RC-/M3M-/M4T-Diagnose](https://github.com/mason82-dotcom/SkyHub/pull/27) | Direkter Main-PR, über 20 Dateien inkl. Parser, Katalog, `server.js` und CI | Auf aktuellen Katalog, bereits übernommenes M3M-Overlay und #26-Fix rebasen; Modell-Zeitfrische und Hardwareevidenz getrennt prüfen | Nach dem isolierten #61-Fix, **keine pauschale 1.18-Abnahme** |
| **P1-Lab** | [#46 – HiveMind-Pilot/Dock/Wayline/HMS](https://github.com/mason82-dotcom/SkyHub/pull/46) | Direkter Main-PR; eigenständiges Simulationslabor, separate CI und Compose | Isolationsnetz, private Wegwerf-Credentials, AGPL-Kompatibilität, keine produktiven Broker-/Volumes. Simulator basiert auf DJI-SDK **1.16.1.3** | Als **separate opt-in Laborreferenz**, nicht als Betriebsfeature |
| **P2** | [#24 – MinIO/M3M-Funktionslinie](https://github.com/mason82-dotcom/SkyHub/pull/24) | Direkter Main-PR, **über 100 geänderte Dateien**, darunter Backend, Auth, MQTT, Registry, Compose, Frontend und Medien | Nach Funktionsgrenzen zerlegen; authentifizierte read-only Medieninventur, S3-ACL/Prefix, bestehende Pi-Speicher-/Token-Verträge und Migrationen getrennt abnehmen | **Kein Direktmerge** |
| **P2** | [#28](https://github.com/mason82-dotcom/SkyHub/pull/28) → [#29](https://github.com/mason82-dotcom/SkyHub/pull/29) → [#30](https://github.com/mason82-dotcom/SkyHub/pull/30) | TSA-Proxy/Replay → integrierte WPML-/Diagnostik-/MinIO-Tools → opt-in-KMZ-Inspektion | Vorfahren zuerst reviewen; unkontrollierte Schreibpfade, Trusted-Proxy-Vertrauen, WPML `flightReady=false` und Eingabelimits nachweisen | In isolierten Integrationsbranch konsolidieren |
| **P2-UI** | [#31](https://github.com/mason82-dotcom/SkyHub/pull/31), [#32](https://github.com/mason82-dotcom/SkyHub/pull/32), [#35](https://github.com/mason82-dotcom/SkyHub/pull/35), danach [#41](https://github.com/mason82-dotcom/SkyHub/pull/41) → [#42](https://github.com/mason82-dotcom/SkyHub/pull/42) | #31/#32/#35 sind **nur im Integrationsbranch** gemergt; #41/#42 separate UI-Stack-Kette | Auth, Live-Frische, Token-Leaks, Karten-Zustand, MinIO-GET-only und fehlende Backend-Montage korrekt markieren | UI-Pfade ohne neue Backend-Rechte reviewen |
| **P3** | Pilot-2-Medien STS/Bibliothek ([#33–#40](https://github.com/mason82-dotcom/SkyHub/pull/33)) | Gestapelte HTTPS, STS, PostgreSQL, HEAD- und TIFF-/XMP-Komponenten | Separate Identität, MinIO-Aktionen, Redis-Quoten, CSP/TLS, Audit, Datenbank-Backup/Restore und Medien-Parser-Sandbox; **kein** voreiliges Mounten | Nur nach erfolgreicher P2-Basis |
| **P3** | Smart Farming / Vision / Thermal | Gestapelte Offline-Experimente, teils auf Medien-Branch | Lizenz, reale Datenherkunft, DN→Reflexion, Bandregistrierung, Georeferenz, Ground-Truth, Kalibrierung und Privacy; keine operativen Bereitschaftsflags | Forschung/Labor getrennt von Main-Runtime |

### Quervergleiche vor dem Merge

- [#19](https://github.com/mason82-dotcom/SkyHub/pull/19), [#23](https://github.com/mason82-dotcom/SkyHub/pull/23), [#25](https://github.com/mason82-dotcom/SkyHub/pull/25) und #24 enthalten überlappende MinIO-/Inventur-/Backup-Themen. **Nur eine konsolidierte Implementierung pro Verantwortung.**
- [#16](https://github.com/mason82-dotcom/SkyHub/pull/16) (WPML) und [#44](https://github.com/mason82-dotcom/SkyHub/pull/44) (Drittanbieter-Referenz) sind offline; keine Wayline-/Kameraaktionen live ausführen.
- [#21](https://github.com/mason82-dotcom/SkyHub/pull/21), [#22](https://github.com/mason82-dotcom/SkyHub/pull/22) und [#18](https://github.com/mason82-dotcom/SkyHub/pull/18) dokumentieren spezifische Gerätebefunde oder Diagnoseprototypen; nicht unbesehen auf #27 addieren.
- [#1](https://github.com/mason82-dotcom/SkyHub/pull/1) ist eine ältere, noch offene historische Entwicklungsbasis. Sie darf nicht als neuer Integrations-Root gelten.

## 3. Konkreter Abhängigkeitsgraph

```text
main (496a1f84…)
 ├─ #61  Regex + HTTP-Tests                     [MERGED]
 ├─ #47  Offline DJI 1.18 Paritätsaudit         [MERGED; nur synthetisch]
 ├─ #27  Hardware-Diagnose                      [als Nächstes konsolidieren]
 ├─ #46  Isoliertes HiveMind-Labor              [eigenständig]
 └─ #24  Große MinIO/M3M/TSA-Basis              [ZERLEGEN, nicht direkt mergen]
      ├─ #28  TSA-Proxy-Schutz
      │    └─ #29  WPML + UI + Diagnostik       [develop-Integrationsbasis]
      │         ├─ #30  KMZ-Inspect-API         [Draft]
      │         └─ #31 + #32 + #35              [nur in develop gemergt]
      └─ #33  Passive service-reply Vertragsprüfung
           └─ #34  Pilot-Media-STS-Guard
                └─ #36  MinIO STS Issuer
                     └─ #37  verifizierte Registrierung
                          └─ #38  Pilot-Media HTTPS
                               └─ #39  verifizierte Lesebibliothek
                                    └─ #40  eng begrenzte S3-XMP-Probe
                                         ├─ #48  Offline Indexraster
                                         │    └─ #51  TIFF-Payload-Audit
                                         │         └─ #55  DEDAL/ODM-Ortho-Handoff
                                         │         └─ #59  DEDAL-ZIP-/M3M-Preflight (ohne Ausführung)
                                         └─ #43  RGB YOLO11
                                              └─ #45  Thermal Pixel→GPS
                                                   └─ #49  lokale HMAC-Provenienz
                                                        └─ #50  manuell gepinntes Kameraprofil
                                                             └─ #52  JPEG/XMP-Präsenzmarker
                                                                  └─ #54  MP4/MOV + SRT-Zeitstruktur
                                                                       └─ #56  relative MP4 DTS/PTS-Samples

Separate UI-Kette: feature/dashboard-next-ui → #41 → #42
Separater WPML-Referenzzweig: #16 → #44 sowie #16 → #57
Unabhängiges UI-Draft: main → #58 (TAK-/CoT-Platzhalter; keine Backend-Integration)
```

Der Graph bezeichnet **Branch-Bases**, nicht automatisch verschmelzbare Codeänderungen. #41 liegt auf `feature/dashboard-next-ui`, nicht schlicht auf `main`. Jede Kette kann weitere nicht dokumentierte Vorfahren enthalten; Git-Baum-/Merge-Base prüfen.

## 4. Neue Forschungs-PRs #54–#56 (23.10.2026)

| PR | Tatsächliche Aussage | Noch nicht nachgewiesen |
| --- | --- | --- |
| [#54](https://github.com/mason82-dotcom/SkyHub/pull/54) | Eng begrenzte **offline** MP4/MOV-Zeitstruktur und separat gepinnte SRT-Cues, nach HMAC-/Capture-Prüfung | Kein GPS-/UTC-Abgleich, kein Video-Frame-Decoding, keine M4T/M3T-Sensorfreigabe |
| [#55](https://github.com/mason82-dotcom/SkyHub/pull/55) | Experimente mit extern bereits erzeugten DEDAL/ODM-Fünfband-Orthomosaiken: DN-Skalierung in Float-Reflexion bei strenger Raster-/Maskenprüfung | **Keine** validierte DJI-DN→Reflexion-Kalibrierung; externes `accepted` nur manuelle Behauptung, kein Agronomie-/NDVI-Betriebsnachweis |
| [#56](https://github.com/mason82-dotcom/SkyHub/pull/56) | Offline-Validierung relativer MP4-Decode-/Presentation-Zeitachsen (DTS/PTS), synthetische Prüfungen | Kein absoluter Frame-Zeitpunkt, kein DJI-OSD-/RTK-Abgleich und keine SAR-/Personen-Lokalisierungsfreigabe |

**Es existiert damit weiterhin kein belastbarer automatischer Datenweg von rohen DJI-M3M-/M4T-Medien über kalibrierte/registrierte Messwerte zu einsatzfähigen Karten oder Personenstandorten.**

## 5. Ergänzungen aus den PRs #57–#59

| PR | Base / technischer Umfang | Abnahmegrenze |
| --- | --- | --- |
| [#57 – Motecshine Waylines](https://github.com/mason82-dotcom/SkyHub/pull/57) | **Gestapelt auf #16**, nicht auf Main. Lokaler JSON→WPML-Editorimport, keine DJI-API-Schreibrechte | Lizenz-/Go-Modulpfad prüfen; fremde RC-Loss-/SubEnum-Defaults **nicht** unbemerkt übernehmen; keine M3M-/Hardware-/Flugfreigabe |
| [#58 – TAK-/CoT-Zweittab](https://github.com/mason82-dotcom/SkyHub/pull/58) | **Direkt auf Main**, reines Dashboard-UI mit ARIA-/Tastaturbedienung und fail-closed Platzhalter | UI-Tests, Fokus-/Karten-Rückwechsel, keine CoT-Netzwerk-/Backend-Rechte. Separat reviewbar ohne die gestapelte Medienkette |
| [#59 – DEDAL-Preflight](https://github.com/mason82-dotcom/SkyHub/pull/59) | **Gestapelt auf #55**; rein lokaler ZIP-/TIFF-Dateinamen-/Panelzertifikats-Check mit SHA-256-Pinning, **keine** DEDAL-Ausführung | Kein echtes ZIP inspiziert, keine echte Kalibrierung, keine DJI-Fünfband-Orthomosaik-Verifikation; private Manifeste bleiben lokal |

## 6. Verbindliche Merge-Gates

| Gate | Nachweis für jeden Integrationskandidaten |
| --- | --- |
| **G0 – Provenienz** | PR-Head-SHA, Base-SHA, Branch-Base, Lizenz, ausschließlich bekannte/prüfbare Quellen; keine fremden Gewichte oder unklaren DJI-Binaries |
| **G1 – Diff-Scope** | Vollständige Dateiliste gegen *aktuelle* Main-Basis und gestapelte Base. Keine Nebenänderung an `.env`, Produktiv-Compose, Caddy/EMQX oder bestehenden Volumes |
| **G2 – Sicherheit** | Allowlist, Auth/Workspace, HTTPS, Broker ACL, keine Secrets/Koordinaten in Logs, klare No-write-/Offline-Grenze, keine untrusted Parsers im Backend ohne Sandbox |
| **G3 – CI** | Zielcommit mit grünem Node-/Python-/SQL-/Compose-Test, isolierte PostGIS-/MinIO-/Simulator-Abnahmen nach Bedarf; Tests für negative Fälle |
| **G4 – Datenmodell** | Migrationsplan für existierende PostGIS-Volumes, echte Sicherung + isolierter Restore; keine automatische destruktive Schemaänderung |
| **G5 – Hardware** | DJI-Gerätemodell + Pilot-Firmware + Cloud-API-Version + beobachtete Nachrichten/Medien-/GPS-Qualität, reproduzierbare zeitlich datierte Abnahme |
| **G6 – Betrieb** | Separater Pi-Preflight, planbarer Rollback, explizite Freigabe für Dienständerungen; GitHub-Merge **nicht** als Deployment ausgeben |
| **G7 – Dokumentation** | README, Architektur, API/Compose-Referenz, Funktions-/Modulstatus und PR-Abhängigkeiten auf neuen Main-SHA aktualisieren; historische Evidenz unverändert datieren |

## 7. Nächste technisch kleine Arbeitspakete

1. **Erledigt – #61:** Modell-Diagnose-Regex isoliert behoben und real über HTTP-Tests abgesichert. Kein Pi-Update.
2. **Erledigt – #47:** synthetischen, strikt lokalen Paritätsaudit aufgenommen; keine Live-Geräteabnahme.
3. **P1 als Nächstes – #27:** gemeinsame Hardwarediagnosen gegen Main inklusive #61 und #47 prüfen; echte OSD-Feldpfade, Frischegrenzen und RC/M4T-spezifische Nicht-Anwendbarkeit getrennt zählen.
4. **P2-Storage-Stückelung**: #24 in unabhängige PRs teilen (Read-only-M3M-Dateinamen, S3-Leseadapter, HTTP-Auth, Backup/Restore, TSA). Security-Pfade vor UI-Montage freigeben.
5. **P3-Forschungszweige**: bestehende Offline-Experimente unverändert isoliert halten, bis Herkunfts-/Kalibrierungs-/Lizenz-/Privacy-Gates belegt sind.

**Stop-Bedingung:** Jede unerwartete Änderung an Pilot-Pairing, Caddy/EMQX-Rechten, Container-Ports, PostGIS-Schema, MinIO-Policies oder realen DJI-Missionspfaden stoppt die Konsolidierung bis zu einer gesonderten Betriebsfreigabe. Kein automatischer Merge von Draft-PRs und keine realen Flugbefehle zum Testen.
