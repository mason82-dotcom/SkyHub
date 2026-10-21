# DJI Cloud API: Kompatibilitätsabgleich für SkyHub Next

> **Aktueller Feldabgleich:** [DJI Cloud API 1.18 – sechs Gerätemodelle](dji-118-field-audit.md). Der Katalog enthält 144 Mavic-3-, 199 vorläufige Matrice-4T-, 48 RC-Pro- und 54 RC-Plus-2-Feldpfade sowie neun dynamische Gimbal-Feldtypen im vorläufigen Aircraft-Profil. Alle werden lesend und mit typisierten Whitelists verarbeitet. Für M3M und Matrice 4T ist die gerätespezifische 1.18-Kompatibilität weiterhin nicht belegt; auch die RC Plus 2 benötigt noch eine Hardwareabnahme.

Zielstand: DJI Cloud API 1.18 (vom Projekt vorgegeben). Protokolldetails gelten nur soweit durch die verlinkten offiziellen API-Referenzen belegt. Vollständige 1.18-Konformität ist nicht getestet.

## Eingesetzte Referenzen

- Offiziell: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/
- Gerätekennung: https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-support.html
- Pilot-Topologie: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/rc-plus/device.html
- Fluggeräte: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/aircraft/properties.html
- RC Pro Enterprise: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/rc-pro/properties.html
- Aircraft-OSD: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/aircraft/properties.html
- Alt-Demo: https://github.com/dji-sdk/Cloud-API-Demo-Web (laut DJI seit 10.04.2025 nicht mehr gepflegt)

## Eingereichte api.zip

Das bereitgestellte Archiv enthält AeroNexus-On-Prem-Patches gegen die DJI-Referenzdemos von April 2025:

- Backend: Spring Boot / Java 11, gepatchte Matrice-4-/RC-Plus-2-Gerätekennungen, WHIP-Stream-URL.
- Control: Vue 3, Vite 2, Gerätebezeichnungen, AMap-zu-Leaflet-Adapter, WebRTC-WHEP/HLS-Player.
- Edge: eigener Compose-Stack mit MySQL, Redis, EMQX, MinIO und MediaMTX.
- Diese Dateien sind KEINE DJI-Cloud-API-1.18-Spezifikation und wurden nicht in SkyHub Next übernommen.

## Umgesetzte Abweichungen

1. Read-only MQTT-Topics: sys/product/{gateway_sn}/status, thing/product/{sn}/osd, thing/product/{sn}/state, events und services_reply.
2. Topologie update_topo: Gateway-Untergeräte-Kanten, Unterscheidung von Pilot- und Dock-Varianten, verschiedene Datentypen für version, index und domain.
3. Geheimnisse aus Topologie-Nachrichten werden nicht in den Browser, den Gerätekatalog oder das Cache-Modell übernommen.
4. Gerätemodelle werden nur anhand der Kombination domain/type/sub_type aufgelöst. Kamera-Typ 89 ist nicht mit Fluggerät-Typ 89 gleichzusetzen.
5. Eindeutige Flughöhen: elevation (relativ zum Startpunkt) und height (Ellipsoidbezug) sind getrennte Werte.
6. mode_code aus OSD und state, nicht ausschließlich aus state.
7. PostGIS: device_sn als Fluggerätekennung, gateway_sn optional; beide dürfen nicht verwechselt werden.
8. Stale-Packets überschreiben keine neueren OSD-Meldungen; reine Topologie- und Statusnachrichten erzeugen keine fingierte OSD-Frische.

## Telemetrie-Feldinventar (21.10.2026, Hardware-Snapshot)

Die RC Pro Enterprise meldete fünf der 17 bisher normalisierten Felder
(`latitude`, `longitude`, `heightEllipsoid`, `battery`, `linkQuality`).
Die Mavic 3M meldete 14 von 17; es fehlten die zwei gültigen GPS-Koordinaten
(DJI lieferte `0,0`) und `linkQuality`, ein Gateway-spezifisches Feld.
Die Profil-Diagnose unterscheidet deshalb typische RC- und Aircraft-Felder,
optionale zusätzliche DJI-Werte und für die Rolle nicht anwendbare Felder.
Die Verfügbarkeit im Snapshot belegt nicht, dass ein Wert in jedem OSD-Paket
vorhanden oder ein GNSS-Fix gültig war.

Die Parser-Erweiterung wertet nur dokumentierte, optionale DJI-OSD-Lesefelder
aus: Wind, kumulierte Flugwerte, SDR-/4G-Verbindungszustände und
4G-Signalqualität. Windrichtung ist ein Sektor-Code 1–8, kein Gradwinkel.
Ungültige Signalqualitäts-Sentinels (z. B. 65535) werden verworfen.
RTK bleibt optional; die fortlaufende Positionsaufzeichnung bleibt aus.

## Ausdrückliche Einschränkungen

- Mavic 3M: Das Fluggerät `0/77/2` ist seit dem 20.10.2026 per Hardware bestätigt (Topologie über die RC Pro Enterprise) und eingetragen. Die im AeroNexus-Patch genannte **Kamera**-ID 68 bleibt unbestätigt und ist weiterhin nicht zugeordnet.
- Die zusätzliche Cloud-API-1.18-Funktionspalette muss getrennt anhand der offiziellen gerätespezifischen Schemas verifiziert werden. Es werden keine neuen Flugsteuerungs- oder FTS-Methoden blind übernommen.
- Die Demo enthält Pilot-2-JSBridge und vollständige Arbeitsbereiche; SkyHub Next besitzt derzeit nur das gesicherte Read-only-Monitoring. Pilot-2-Onboarding, Medienimport, Video und Wayline-Verwaltung sind eigene zukünftige Adapter.
- Die Backends der DJI-Demo basieren auf anderen Java-/Vue-Bibliotheken. Versionen aus diesem Archiv sind keine Empfehlungen für das neue Node.js-Projekt.
- Alte ZIP-Konfigurationen und Zugangsdaten werden nicht übernommen.

## Prüfstatus

Node-JS-Parser- und Registrierungs-Tests sowie der Docker-Compose-/Container-Build laufen auf dem PR-Branch in GitHub Actions.
Ohne tatsächliche Pilot-2-/Aircraft-/Dock-Hardware bleibt die Protokollvalidierung unvollständig.
