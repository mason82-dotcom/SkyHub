# SkyHub Next – Dokumentationswegweiser

**Aktualisiert am 23.10.2026.** Diese Navigation gilt für den Root-Stack `skyhub-next`. Die wichtigste Unterscheidung ist die zwischen dem **Code auf `main`** und **noch nicht integrierten Entwicklungszweigen**.

## Zuerst lesen

1. [README / Produktumfang und sichere lokale Checks](../README.md)
2. [Projektstand 23.10.2026 / verifizierter Main-SHA, PR-Status und Integrationsgates](projektstand-2026-10-23.md) – **maßgeblich für aktuelle Fortschrittsaussagen**
3. [Architektur, Datenwege und API](architecture.md)
4. [Sicherheitsmodell, Authentifizierung und LAN/TLS](security.md)
5. [Betrieb, Checks und kontrolliertes Backend-Update](ops.md)
6. [Konfigurationsreferenz: Compose, Env und Feature-Flags](config-reference.md)
7. [API-Referenz: HTTP, Socket.IO, MQTT, Autorisierung](api-reference.md)

## Technische Referenz des Hauptbranches

| Bereich | Dokumente |
| --- | --- |
| DJI MQTT, OSD, Pilot-2-Handshake | [MQTT/OSD](mqtt-osd-integration.md), [DJI Cloud API](dji-cloud-api-compatibility.md) |
| Geräte-/Feldabdeckung | [DJI 1.18-Feldkatalog](dji-118-field-audit.md), [RC Pro + M3M Hardwarebefund](hardware-rc-pro-m3m.md) |
| DJI-Kartenelemente (GET, interner Schreibentwurf) | [Feld-/Schnittstellenvertrag](dji-map-element-contract.md), [Berechtigungen](dji-map-access.md), [Mutationsvertrag – nicht live](dji-map-mutation-contract.md) |
| Geodaten- und Datenbanktests | [Isolierte PostGIS-Validierung](postgis-isolated-validation.md), [DJI-Referenz-Roadmap](dji-reference-roadmap.md) |
| Betriebssicherheit und Migration | [Skriptwirkung](scripts.md), [Legacy-Migration](legacy-migration.md), [Legacy-Dependency-Audit](legacy-dependency-audit.md), [Takeover/Rollback](skyhub-legacy-takeover.md) |
| Frontend-Kontrakte | [UX-CONTRACT](../UX-CONTRACT.md), [DESIGN](../DESIGN.md) |

## Historische Momentaufnahmen – nicht als Live-Betriebszustand verwenden

- [Entwicklungsplan 20.–21.10.2026](entwicklungsplan-2026-10-20.md)
- [Storage-Audit 20.10.2026](storage-audit-2026-10-20.md)
- Die Pi-Port-/Broker- und Hardwarediagnosen in den betroffenen Runbooks nennen ausdrücklich ihr Aufnahmedatum.
- [Archivierter Legacy-Snapshot](../stacks/README.md) dient dem Vergleich und darf **nicht** parallel zur laufenden Installation gestartet werden.

## Feature-PRs lesen und bewerten

Der [Projektstand](projektstand-2026-10-23.md) verlinkt die Entwicklungsketten für WPML, Command Center, MinIO und Pilot-2-Medien, Multispektral-Auswertung, YOLO11, Thermal-Geolokalisierung und HiveMind. Viele PRs nutzen **andere PR-Branches als Base**. Deshalb befinden sich die zugehörigen Dateien noch nicht im Main-Dateibaum; deren Fach-/Lizenzdokumentation kann in der GitHub-Oberfläche im jeweiligen PR-Branch eingesehen werden.

**Statuskonvention:** „Unit/CI bestanden“ ≠ „mit DJI-Gerät verifiziert“ ≠ „auf dem Raspberry Pi installiert“ ≠ „flug-/einsatzfreigegeben“. Ein PR, der bereits in den Integrationsbranch gemergt wurde, gilt weiterhin **nicht** als in Main integriert.

## Dokumentation bei Änderungen pflegen

- Nach Code-Merges: Main-SHA, Branch- und PR-Status, betroffene APIs, Sicherheitsdefaults, Tests und Pi-Risiken gegen den wirklichen Code erneut ermitteln.
- Bei neuen Features: **Ist-Implementierung**, **Feature-Flag**, **Test-Evidenz**, **Berechtigungen**, **Hardwarebefund** und **offene Gates** getrennt festhalten.
- Datierten historischen Befunden nie rückwirkend neue Betriebswerte unterschieben. Stattdessen eine neue Momentaufnahme erstellen und hier verlinken.
- Keine Kennwörter, tokens, Seriennummern, private Koordinaten, Rohbilder, HMAC-Schlüssel oder Live-Telemetrie in Repository-Dokumente aufnehmen.
