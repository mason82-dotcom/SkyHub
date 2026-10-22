# DJI Cloud API 1.18 – gerätespezifischer Feldabgleich (read-only)

Stand: 2026-10-21. Zielversion des SkyHub-Projekts: DJI Cloud API 1.18.

## Referenz und Abdeckungsstatus

Die drei ursprünglichen, quellseitig überprüfbaren MQTT-Property-Tabellen wurden aus
[`dji-sdk/Cloud-API-Doc`](https://github.com/dji-sdk/Cloud-API-Doc)
mit festem Commit `4ec6b0c7f9472aeb09a0a47949855d19c473ea07` extrahiert.
Daraus stammt der maschinenlesbare Katalog
[`backend/data/dji-cloud-api-118-fields.json`](../backend/data/dji-cloud-api-118-fields.json).
Die offiziellen *aktuellen* Modellkennungen werden separat mit
[DJI Product Support](https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-support.html)
abgeglichen.

**Wichtig:** Die GitHub-Referenztabellen enthalten nicht alle gerätespezifischen
Erweiterungen, die DJI in der Webdokumentation später veröffentlicht hat.
Der Katalog ist damit **kein Nachweis einer vollständigen 1.18-Feldabdeckung**.
Es werden insbesondere keine angeblichen, aber nicht belegten Matrice-4T-
oder RC-Plus-2-Sonderfelder erfunden.

| Gerät | DJI domain/type/sub_type | Feldprofil | Quellenstatus |
|---|---|---|---|
| Mavic 3E | `0/77/0` | `mavic3`, 144 Pfade | offizielle Mavic-3-Familientabelle |
| Mavic 3T | `0/77/1` | `mavic3`, 144 Pfade | offizielle Mavic-3-Familientabelle |
| Mavic 3M | `0/77/2` | `mavic3`, 144 Pfade | **vorläufiges** Familienprofil; ID am 20.10.2026 am echten Gerät beobachtet, nicht in der DJI-Cloud-Produktliste |
| Matrice 4T | `0/99/1` | `matrice4T`, 199 statische + 9 dynamische Gimbal-Feldtypen | **vorläufig**: 162 archivierte Aircraft-Pfade + 37 dokumentierte generische Ergänzungen; am 22.10.2026 am echten Gerät beobachtet (siehe Hardwarebeobachtung), Verfügbarkeit weiter nicht vollständig verifiziert |
| RC Pro Enterprise | `2/144/0` | `rcPro`, 48 Pfade | offizielle RC-Pro-Feldtabelle |
| RC Plus 2 Enterprise | `2/174/0` | `rcPlus2`, 54 Pfade | eigenes, gegen die DJI-Webdefinition vom 03.09.2025 abgeglichenes RC-Plus-2-Profil; am 22.10.2026 am echten Gerät beobachtet (siehe Hardwarebeobachtung), Abnahme mit Livestream und SIM ausstehend |

Die Felderzahlen enthalten verschachtelte `struct`- und `array`-Pfade,
also keine Garantie für ebenso viele gleichzeitig sendende Messwerte.
Die vollständigen Quellreferenzen samt Datei-SHA befinden sich im Katalog.
Das zusätzliche RC-Plus-2-Profil stammt aus der offiziellen
[DJI RC Plus 2 Property-Referenz](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/properties.html)
mit Seitenstand 03.09.2025 (am 21.10.2026 überprüft). Anders als die drei archivierten
GitHub-Profile ist die Webreferenz nicht auf einen Git-Blob gepinnt. Die neu
abgeglichenen Felder sind `wireless_link.4g_link_state`,
`wireless_link.4g_quality`, `wireless_link.4g_uav_quality`,
`wireless_link.4g_gnd_quality`, `wireless_link.4g_freq_band`,
`cloud_control_auth` (absichtlich redigiert) und `drc_state`.
Das im älteren RC-Pro-Profil enthaltene `country` fehlt in dieser
RC-Plus-2-Seite und wurde nicht ungeprüft übernommen.

Das Matrice-4T-Profil erweitert die allgemeine Aircraft-Tabelle um sechs
belegbare Pfade aus der [DJI Pilot-to-Cloud Aircraft Property-Referenz](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/aircraft/properties.html)
(Seitenstand 28.06.2024): `distance_limit_status` samt drei Unterfeldern,
`rth_altitude` und `rc_lost_action`. Diese Referenz erschien **vor** der
Matrice 4T und ist keine gerätespezifische Unterstützungsgarantie. Die Werte
werden nur gelesen, niemals als `property/set` oder Flugkommando gesendet.
Hinzu kommen elf generische Aircraft-Pfade für `payloads` (verschachtelte
Payload-Statusinformationen), `rid_state`, `wpmz_version`,
`current_rth_mode` und die dokumentierten Commander-Statusfelder.
Diese sind **nicht als M4T-validierte Features ausgewiesen**; die Feldwerte
werden erst verarbeitet, wenn die reale DJI-Firmware sie liefert. Das
dynamisch benannte DJI-OSD-Objekt `{type-subtype-gimbalindex}` wird
mit höchstens acht Gimbal-Einträgen und neun numerischen Statusfeldern
unter `deviceProperties.osd.payload_gimbals` abgelegt. Nur passende
Geräteprofilkennungen dürfen es verwenden; keine SNs, freien Strings
oder unbekannten Payload-Attribute werden übernommen. Laser-Zielkoordinaten
werden nur als vollständiges, gültiges WGS84-Paar akzeptiert.

Zusätzlich sind aus derselben offiziellen allgemeinen Aircraft-Referenz
**20 PSDK-Feldpfade** als vorläufige Kandidaten importiert:
`psdk_ui_resource` (Geräteindex/Bereitschaft) und
`psdk_widget_values` (numerische Widgetwerte und Lautsprecherstatus).
Zustände und Lautstärke werden anhand der dokumentierten DJI-Codes und
Zahlenbereiche geprüft. Namen, Seriennummern, Versionstexte, OSS-Objektschlüssel,
Dateinamen und Prüfsummen sind absichtlich redigiert. Arrays bleiben auf
maximal acht Elemente je Ebene begrenzt. Diese PSDK-Strukturen sind **nicht**
als für die Matrice 4T freigegeben oder hardwarebestätigt zu betrachten.

Die dokumentierten Laserzustände 1 (TOO_CLOSE), 2 (TOO_FAR) und 3 (NO_SIGNAL)
unterdrücken jetzt auch eventuell mitgesendete Laser-Zielkoordinaten,
Zielhöhe und Distanz. Zustand 0 (NORMAL) gestattet gültige Koordinatenpaare.
Diese Schutzregel gilt ausschließlich für die neu integrierten generischen
Gimbal-Felder. Ein GPS-Trackpunkt wird daraus niemals erzeugt.
Dokumentierte Enumerationen werden auf bekannte Codes begrenzt; neue Codes
müssen nach DJI-Schema-Abgleich ausdrücklich ergänzt werden.

## Implementierte Verarbeitung

- `backend/dji-properties.js` verarbeitet die typisierten, verschachtelten Felder nach der referenzierten Definition, ohne frei unbekannte DJI-Keys durchzureichen.
- Pro Kanal wird der bei DJI **am Rootfeld** definierte `pushMode` verwendet: `osd` (0) und `state` (1). Verschachtelte Unterfelder erben den Rootkanal.
- Zahlen, Integer, Boolesche Werte und wenige strikt validierte kurze Geräte- beziehungsweise Firmwarekennungen werden angenommen. Andere Texte, etwa IMEI, EID, Akku-SN, Geräte-SN, Streaming-URL, freie Zeichenketten und `control_source`, bleiben **absichtlich redigiert**.
- Array-Größe ist auf acht Elemente beschränkt; dynamische und unbekannte Eigenschaften werden verworfen. Keine MQTT-Rohpayloads oder Gerätesecrets gelangen in Socket.IO, API, Redis oder Logs.
- `backend/registry.js` stellt `deviceProperties.osd` und `deviceProperties.state` mit getrennten Kanalzeitstempeln (`propertyObservedAt`) und für jeden bereinigten Feldpfad eigenständigen Beobachtungszeiten (`propertyFieldObservedAt`) bereit. Ein frisches Windfeld macht dadurch ältere Kamera-/Akkuwerte **nicht** ebenfalls frisch. Der ursprüngliche normalisierte Telemetrieadapter bleibt unverändert.
- Die für [DJI RC Plus 2 Enterprise dokumentierten](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/properties.html) Streamfelder `video_index`, `video_type` und `switchable_video_types` werden nun als validierte Kurzindizes und feste Kameratyp-Bezeichnungen verarbeitet. `video_id` und `sn` bleiben aus Datenschutzgründen redigiert.
- Für `latitude`/`longitude` gilt WGS84 (-90..90 und -180..180). Die maschinenlesbaren älteren DJI-Tabellen verwenden teilweise ungeeignete Float-Mindestwerte (`-1.4E-45`); diese dürfen **gültige westliche/südliche Koordinaten nicht verhindern**. DJI-Nullposition (`0,0`) und partielle Koordinatenpaare überschreiben kein zuvor geprüftes Positionspaar, auch nicht im Raw-Properties-Snapshot.
- Ein Aircraft-OSD **ohne `mode_code`** markiert ein zuvor getrenntes Fluggerät nicht automatisch wieder als verbunden. Erst eine neue explizite Zustandsmeldung darf die Replay-Sperre aufheben.
- Meldungen mit `mode_code=14` (Fluggerät nicht verbunden) dürfen weiterhin keinen angeblich frischen OSD-Wert erzeugen.
- Die registrierte Topologie entscheidet das verwendete Modellprofil; zuvor empfangene oder unbekannte Daten werden nicht blind einem Gerätetyp zugeordnet.
- `GET /api/diagnostics/dji-fields?model=0:77:2` liefert die Wert-freien Definitionen nach regulärer View-Token-Authentifizierung. Dieselbe API unterstützt alle sechs genannten DJI-Typen. Beim erweiterten M4T-Profil enthält die Antwort **getrennte Quellangaben** für die fest gepinnte GitHub-Basistabelle (`source`) und die dokumentierten generischen DJI-Web-Erweiterungen (`extensionSource`, `extensionSourceEdition`, `extensionVerifiedAt`). Das Vertrauensniveau bleibt ausdrücklich `shared-aircraft-with-web-extensions-unverified`.
- `node scripts/pi-telemetry-fields-check.js` zeigt zusätzlich dokumentierte Pfadzahlen und beobachtete Feldnamen pro Gerät an; kein Rohwert oder Seriennummer wird ausgegeben. **Aktuell** bedeutet je Feld eine letzte validierte Beobachtung innerhalb von 15 Sekunden, nicht lediglich eine neue Meldung auf dem betreffenden MQTT-Kanal. Historisch beobachtete Werte werden separat gezählt. Die Diagnose zählt **auswertbare**, absichtlich **redigierte** und wegen untypisierter Arrays **nicht unterstützte** Felder getrennt. Absichtlich aus Datenschutzgründen verworfene Kennungen gelten nicht als `nicht beobachtet`.

## Hardwarevalidierte Mavic-3M-Erweiterung (21.10.2026)

Der echte RC-Pro-Enterprise-/Mavic-3M-Hardwaretest nach dem kontrollierten
SkyHub-Backend-Update bestätigte die Gerätezuordnung in der live
akzeptierten MQTT-Topologie (M3M: `0:77:2`). Im neuen
**modellbezogenen**, ausschließlich lesenden MQTT-Feldkatalog wurden
drei zusätzliche Aircraft-Rootfelder konkret in Mavic-3M-OSD beobachtet:

- `distance_limit_status` – Distanzbegrenzungsstatus, dokumentierter
  verschachtelter `struct`;
- `rth_altitude` – eingestellte Rückkehrhöhe (RTH);
- `rc_lost_action` – konfigurierte Aktion bei Verbindungsverlust zur RC.

**Nachweisgrenze:** Beobachtet wurden ausschließlich die Root**namen**.
Werte, Typen, Unterfelder, Grenzbereiche und Enum-Codes wurden in dieser
Live-Sitzung **nicht** protokolliert und deshalb nicht auf M3M-Hardware
bestätigt. Die typisierten Grenzen stammen aus der generischen
[DJI Aircraft Property Reference](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/aircraft/properties.html),
Editionsstand 2024-06-28. Es dürfen daraus insbesondere **keine**
Aussagen über sicherheitskritische tatsächliche RTH- oder
Verbindungsverlust-Einstellungen abgeleitet werden.

Die Schemaabbildung `mavic3m` enthält **nur sechs zusätzliche
Felddefinitionen** (3 Roots plus 3 Kinder unter
`distance_limit_status`) und erbt alle 144 fest gepinnten Mavic-3-Felder.
Dadurch lautet das vorläufige inventarisierte Profil **150 Pfade**.
Die Mavic 3E und 3T behalten unverändert ihre 144 Definitionen.
`confidence` und `extensionEvidence` kennzeichnen die Hardware-
Validierung auf Rootnamen-Ebene und die noch offene Werteprüfung.

Die neuen Definitionen werden ausschließlich gelesen und mit
DJI-Typ-/Wertebereich-Prüfungen akzeptiert; die generischen
`access: rw`-Metadaten autorisieren **keine** DJI-`property/set`-
Nachrichten. Keine Flugsteuerung, keine RTH-Änderung und keine
Geräte-Konfigurationsänderung.

Bei vorläufiger M3M-OSD-Feldprüfung sind mindestens zu unterscheiden:
`osd`-Nachricht angenommen, dokumentierter Rootname beobachtet,
einzelnes Unterfeld/Enum-Wert tatsächlich validiert und schließlich
hardwarebestätigte Funktion. Jede Stufe benötigt gesonderte Evidenz.

### Rein lesende Hardwareabnahme der sechs M3M-Erweiterungspfade

Die Ergänzung `backend/hardware-validation.js` zeigt künftig getrennt
vom modellbezogenen **Rootnamen-Nachweis** die tatsächlich vom neuen
`mavic3m`-Parser angenommenen **typisierten** Feldpfade an. Erfasst
werden die Roots `distance_limit_status`, `rth_altitude` und
`rc_lost_action` sowie die drei Kinder von `distance_limit_status`.

Der Bericht zeigt pro fest codiertem Pfad nur `FRISCH`, `HISTORISCH`
oder `NICHT BEOBACHTET` sowie Summen. Keine Zahlenwerte von RTH-
Höhen, Distanzbegrenzungen oder Flugsteuer-Konfigurationen werden
ausgegeben. Der Status setzt einen durch den Parser übernommenen
Wert **und** den zugehörigen gültigen per-Field-Zeitstempel voraus.

Wird noch das vorherige Pi-Backend mit `propertyProfile.name=mavic3`
verwendet, lautet der Status explizit `M3M-150-Feldparser: NICHT AKTIV`;
die nicht geladene Profil-Erweiterung wird nicht als fehlende DJI-Hardware
fehlinterpretiert. `NICHT BEOBACHTET` kann außerdem Abwesenheit,
ungültigen Eingabedatentyp oder eine Sanitizer-Ablehnung bedeuten.
Für die endgültige Gerätevalidierung sind diese Ursachen zu trennen;
eine akzeptierte Eigenschaft ist insbesondere **keine Bestätigung**
ihrer sicherheitsrelevanten Wirkung oder korrekten DJI-Firmwaresemantik.

Auf dem Pi wird ausschließlich die vorhandene Diagnoseschnittstelle
gelesen; das Prüfsystem publiziert keine MQTT-Nachricht, verändert
keine Einstellung und löst keine Flug- oder Kameraaktion aus.
## Absichtlich nicht umgesetzt

Keine DJI-`property/set`-Aufrufe, Flight Control, Missionsstarts, Kameraaktionen
oder Broker-ACL-Änderungen. Die bisherigen DJI-Topics, EMQX-Port 1884,
Postgres/Redis/Compose, Caddy und Pilot-2-Pairing bleiben unangetastet.
DJI SmartFarm-Multispektralprodukte wie NDVI/NDRE sind **Medienprodukte**,
keine automatisch verfügbaren MQTT-OSD-Eigenschaften, und werden nicht
als ausgedachte Telemetriefelder eingeführt.

## Hardwarebeobachtung vom 22.10.2026 (RC Plus 2 Enterprise, Matrice 4T)

Quelle: `node scripts/pi-telemetry-fields-check.js` auf dem Pi, rein lesend.
Ausgewertet wurden nur Feldnamen; keine Kennungen, Koordinaten oder Rohwerte.
Die RC Plus 2 war am selben Tag über die Pilot-2-Kopplung angebunden worden.

| Gerät | OSD frisch | Aktuell gemeldete Felder | Beobachtet / auswertbar |
|---|---|---|---|
| RC Plus 2 Enterprise (`2/174/0`) | ja | 14 | 21 / 47 |
| Matrice 4T (`0/99/1`) | ja | 91 | 91 / 178 |

RC Plus 2: Beobachtet sind `capacity_percent`, `height`, `wireless_link`
mit SDR- und 4G-Unterfeldern, `drc_state`, `state:live_capacity` und
`state:firmware_version`. Das stützt das Profil `rcPlus2`. Nicht beobachtet
sind `live_status`, `dongle_infos` und die Kameraliste in `live_capacity`;
diese Felder hängen vermutlich an einem laufenden Livestream bzw. einer
SIM/eSIM, was in diesem Test nicht gegeben war und hier nicht belegt ist.

Matrice 4T: 91 dokumentierte Felder und 5 von 9 dynamischen Gimbal-Feldtypen
(`gimbal_pitch`, `gimbal_roll`, `gimbal_yaw`, `measure_target_error_state`,
`zoom_factor`) waren aktuell. Das Profil bleibt vorläufig, weil 87
auswertbare Felder (u. a. `dongle_infos`, IR-Messbereich) nicht beobachtet wurden.

Grenzen: Bei keinem Gerät war ein GNSS-Fix verfügbar; `latitude` und
`longitude` fehlen, die Nullposition wird bewusst nicht als Position genutzt.
Fehlende Felder belegen keine fehlende Geräteunterstützung. Ein einzelner
Snapshot belegt weder Feldwerte noch deren Plausibilität.

### Nachtrag 22.10.2026: GPS- und RTK-Fix

Zweiter Lauf von `node scripts/pi-telemetry-fields-check.js` mit GPS- und
RTK-Fix an den Geräten (nur Feldnamen und Zählwerte, keine Koordinaten oder
Kennungen):

| Gerät | Typische Felder | Aktuell gemeldete Felder | Position |
|---|---|---|---|
| RC Plus 2 Enterprise | 5/5 inkl. `latitude`, `longitude` | 16 | frisch, zeitverifiziert |
| Matrice 4T | 16/16 | 94 | frisch, zeitverifiziert |

Matrice 4T: Alle 9 dynamischen Gimbal-Feldtypen waren aktuell, neu gegenüber
dem ersten Lauf `measure_target_longitude`, `measure_target_latitude`,
`measure_target_altitude` und `measure_target_distance`. Beobachtete Zählwerte:
17 GPS-Satelliten, 17 RTK-Satelliten, `rtkFixState` 2, `positionQuality` 5.
Die RC Plus 2 meldet keine Satelliten- oder RTK-Felder; sie gehören zum
Fluggerät.

Grenzen: `rtkFixState` und `positionQuality` sind hier nur als beobachtete
Zahlenwerte erfasst. Ihre Bedeutung wurde nicht gegen die DJI-Definition
abgeglichen; daraus folgt kein Nachweis einer gültigen RTK-Festlösung oder
einer bestimmten Genauigkeit. Mavic 3M und RC Pro Enterprise sendeten zu diesem
Zeitpunkt nicht und bleiben bei der Nullposition. Ein Snapshot belegt weder
Dauerhaftigkeit noch Positionsgenauigkeit. Offen bleibt die Prüfung mit
Livestream und SIM/eSIM.

## Verifikation auf dem Pi (ohne Neustart)

```bash
cd ~/Projekte/SkyHub-Next
git fetch origin
git status --short --branch
# Erst nach Sicherung lokaler Änderungen und freigegebenem Checkout:
node --test backend/test/dji-properties.test.js backend/test/telemetry-field-audit.test.js
node scripts/pi-telemetry-fields-check.js
```

Die Testfälle validieren Kennungen, Datenkanäle, Array-Grenzen,
Streamtyp-Whitelist, WGS84-Negativkoordinaten, Nullposition/Teilkoordinaten,
Datenschutz und den Replay-Schutz. Sie ersetzen weder den Vergleich mit
den noch zu importierenden neueren 1.18-Geräteschemas noch reale Pilot-2-/
M4T-/RC-Plus-2-Hardwaretests. Ein GitHub-PR ist kein Pi-Deployment.
