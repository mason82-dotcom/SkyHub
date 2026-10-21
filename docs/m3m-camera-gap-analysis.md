# Mavic 3M – Einordnung fehlender DJI Cloud API Kamera-/State-Feldpfade

**Stand:** 21.10.2026 · **Status:** Offline-Auswertung auf dem Pi lesbar,
kein Backend-Update erforderlich · DJI Cloud API 1.18

## Hardwareevidenz

Der erste reale Raspberry-Pi-Hardwaretest nach der 150-Pfad-Erweiterung
verarbeitete 10/10 OSD-Pakete und zeigte 64 von 150 Feldern frisch.
Der **anschließende echte Pi-Folgetest** auf diesem Diagnose-Testbranch
lieferte 964/964 akzeptierte OSD-Pakete (backendweit) mit ca. 2 Sekunden
altem OSD beider realen Geräte und 66 von 150 auf M3M beobachteten
Feldpfaden (63 frisch, 3 historisch), darunter erneut alle sechs
typisiert angenommenen Generic-Aircraft-Erweiterungspfade.

**Offen im Folgetest:** 74 auswertbare Feldpfade nicht beobachtet,
8 absichtlich redigiert und 2 untypisierte Felder nicht inspectierbar.
Die 74 sind **keine 74 Gerätefehler**; die im Pi-Test bestätigte
Aufteilung wird unten dokumentiert.

## Warum das gemeinsame Kameraschema mehr Felder enthält

Die Mavic 3M besitzt eine 20-MP-RGB-Kamera und vier 5-MP-
**Multispektralkameras** (Grün, Rot, Red Edge, **NIR**).
Sie hat **keine thermische Temperaturmesskamera**. Das
M3-Series-Cloud-API-Schema enthält zugleich IR-Temperaturmessfelder
und Funktionen unterschiedlicher Mavic-3-Gerätevarianten.

**Wichtig:** NIR-Reflexionsbilder erfassen Licht im nahen Infrarot und
sind **keine Wärmebild-/Thermografie-Messung**. Fehlende
`cameras.ir_metering_point`, `ir_metering_area`,
`ir_metering_mode` oder `ir_zoom_factor` sollen deshalb in
der M3M-Abnahme als **nicht zur vorhandenen Thermografiehardware
passend** erklärt werden, nicht als ausgefallene Sensoren.

Referenzen:
- [DJI Mavic 3M – technische Spezifikationen](https://enterprise.dji.com/mavic-3-m/specs)
- [DJI Cloud-API-Doc – Mavic-3-Series Properties](https://github.com/dji-sdk/Cloud-API-Doc/blob/4ec6b0c7f9472aeb09a0a47949855d19c473ea07/docs/en/60.api-reference/10.pilot-to-cloud/00.mqtt/10.m3-series/00.properties.md)

## Neue Diagnoseklassen (ohne neue Telemetrie, keine DJI-Schreibbefehle)

`backend/m3m-gap-classifier.js` klassifiziert **ausschließlich
bekannte, nicht beobachtete M3M-Schema-Pfadnamen** in sechs Klassen:

| Klasse | Interpretation |
|---|---|
| Thermische IR-Mess-/Zoomfelder | M3M hat keine Wärmebildkamera; nicht als fehlende Temperaturmessung bewerten |
| Zoom-/FOV-Felder | Shared-Family-Funktionen, nicht automatisch für die M3M garantiert |
| RGB-/Wide-Belichtung | Potenziell optionale RGB-Kameraeinstellungen, noch nicht beobachtet |
| Andere Kamera-/Anzeigefelder | Bedingte Kamera-/UI-Funktionen |
| State-Felder | Bei Änderungen übertragen; nach Neustart ggf. noch keine Events |
| Sonstige OSD-Felder | Können bedingt oder firmwareabhängig sein; keine Vermutung über Fehler |

Die Auswertung **verändert keine der 150 Felddefinitionen** und
subtrahiert keine Klasse von der bisherigen Zahl `nicht beobachtet`.
Alle Gruppen zusammen ergeben stets die Anzahl klassifizierter
auswertbarer Lücken. Werte, Seriennummern, Payload-IDs, Positionen
und beliebige fremde Key-Namen werden nicht erfasst oder ausgegeben.

## Raspberry Pi: nur vorhandenes Backend lesen

Das neue Hardwarecheck-Skript aus dem **separaten Test-Worktree**
kann mit dem bestehenden produktiven Compose-Verzeichnis getestet
werden. **Kein Backend-Neustart, keine neue MQTT-Subscription,
kein DJI property/set und keine Änderung an Flight Control.**

```bash
git -C ~/Projekte/SkyHub-HW-Test fetch origin
git -C ~/Projekte/SkyHub-HW-Test switch --detach origin/test/m3m-camera-capability-gap-audit-20261021
cd ~/Projekte/SkyHub-HW-Test
node --test backend/test/m3m-gap-classifier.test.js backend/test/rc-pro-m3m-hardware-validation.test.js
SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" node scripts/pi-rc-pro-m3m-check.js
```

**Gesucht im Report:** `M3M-Feldluecken nach Kamerafunktion und
MQTT-Kanal` samt sechs Summen; ältere Backends melden
`NICHT PRUEFBAR` statt Nullwerten. Die reale Pi-Ausgabe wird
separat als Hardwareevidenz ausgewertet, bevor Änderungen in
Produktiv-`main` übernommen werden.

## Reale Feldluecken-Klassifizierung: Pi-Test am 21.10.2026

Der Benutzer hat den isolierten Hardware-Testbranch
`fd1a5ce` auf dem Raspberry Pi getestet. **22 von 22 lokalen
Node-Tests bestanden**, dazu OSD-Live-Telemetrie ohne Neustart
oder Änderungen an den produktiven Containern.

| Funktion/Kanal | Nicht beobachtete Feldpfade |
|---|---:|
| Thermische IR-Mess-/Zoomfelder | **20** |
| Zoom/FOV der gemeinsamen M3-Kamerafamilie | **17** |
| RGB-/Wide-Belichtung | **4** |
| Sonstige Kamera-/Anzeigefunktionen | **1** |
| Ereignisgesteuerte State-Felder | **27** |
| Andere OSD-Felder | **5** |
| **Summe** | **74** |

Zusätzlich waren **14 vollständige Rootfelder** nicht beobachtet,
43 Unterpfade trotz beobachteter Rootstruktur und 17 Unterpfade
unter fehlenden Roots. Diese Rootstruktur-Gruppen betrachten
dieselben 74 Pfade aus einer **anderen Perspektive**; ihre Zahlen
dürfen nicht zusätzlich zu den obigen 74 addiert werden.

**State-Befund:** Trotz 964 OSD-Paketen wurden auf dem Backend
`mqttObservedChannelCounts.state=0` und 0 State/Status-Meldungen
seit dem letzten Backendstart gemessen. Die Subscription
`thing/product/+/state` ist im Quellcode vorhanden und wird
zusammen mit insgesamt fünf Themen geprüft. Der beobachtete
State-Zähler wird *vor* Parsing und Property-Filterung erhöht;
ein fehlerhafter M3M-Sanitizer erklärt 0 Zustellungen also nicht.
State ist ereignisgesteuert – anhaltendes Ausbleiben verlangt
vor Schlussfolgerungen eine gesonderte MQTT-/Pilot2-Beobachtung.

### Weitere ausschließlich lesende State-Kanalanalyse

Der Hardwareprüfer zeigt jetzt zusätzlich drei Ebenen an:
(1) `mqttObservedChannelCounts.state` (Topic empfangen, auch vor
Filterung), (2) `mqttChannelCounts.state` (nach Guard/Registry
angenommen), (3) modellbezogene RC-/M3M-State-Zähler aus der
validierten MQTT-Shape-Erfassung, soweit verfügbar. Diese Ebenen
sind voneinander zu unterscheiden und werden niemals aus einem
`osd`-Zähler abgeleitet.

Ein Gerät kann ein State-Paket erhalten, ohne darin einen
bekannten typisierten Eigenschaftswert zu besitzen. Deswegen
wird die individuelle Eigenschaftsannahme zusätzlich separat
ausgewiesen. Die Auswertung zeigt **ausschließlich Zähler und
fest definierte Statuswörter**, keine SN, GPS-Werte, Settings,
Tokens oder unbearbeiteten Payload-Keys. Sie wird im Test-Worktree
gegen das bereits laufende Pi-Backend ohne erneutes Deployment
ausgeführt.

## State-Nachtest: kein Topic-Empfang trotz OSD-Telemetrie

Im anschließenden echten Pi-Test mit Commit `41d6d64`
(`scripts/pi-rc-pro-m3m-check.js` aus dem Test-Worktree) wurde
folgende Zustandskette **direkt aus den bestehenden Backend-APIs** gelesen:

| Ebene | Live-Nachweis |
|---|---:|
| MQTT-State-Topic empfangen (`mqttObservedChannelCounts.state`) | **0** |
| Nach Guard und Registry akzeptiert (`mqttChannelCounts.state`) | **0** |
| State-Nachrichten dem RC-Modell zugeordnet | **0** |
| State-Nachrichten der M3M zugeordnet | **0** |
| Typisierte RC-/M3M-State-Felder seit Prozessstart | **nein / nein** |

Das OSD wurde zuvor **964/964** mal empfangen, übernommen und als
verwertbare Telemetrie gezählt, mit ungefähr zwei Sekunden
OSD-Frische an beiden Geräten. Der Transport für OSD ist deshalb
bestätigt, das **State-Topic blieb dagegen unbeobachtet**. Der
Beobachtungszähler wird am Anfang von `onMessage()` vor Parsing,
Guard und Feldfilter erhöht; es handelt sich **nicht** um
Parserablehnungen. Die DJI-Dokumentation spezifiziert für
`pushMode=1` State-Übertragung bei Änderung, **nicht zyklisch**.

Offizielle DJI-Referenz:
https://developer.dji.com/doc/cloud-api-tutorial/en/overview/basic-concept/thing-model.html

### Nächste risikofreie Prüfung am Pi

Nur die bestehenden, lesenden Backend-Healthdaten abfragen:

```bash
curl -fsS http://127.0.0.1:4001/api/health | python3 -c '
import json,sys
h=json.load(sys.stdin)
for k in ("mqtt","subscribed","topologyRestoredDevices",
          "mqttLastConnectedAt","mqttLastMessageAt",
          "mqttLastOsdAt","mqttObservedChannelCounts",
          "mqttChannelCounts"):
    print(f"{k}: {h.get(k)}")
'
```

Es werden keine Geräte-IDs oder Telemetriewerte angezeigt.
Die Abfrage **sendet keine MQTT-Nachricht**.
Beobachtung nach einer normalen Pilot-2-/Cloud-Verbindung bei
am Boden stehenden Geräten ist möglich, aber eine Cloud-Neuverbindung
muss **nicht** zwingend State-Nachrichten auslösen.
Bei weiterhin ausbleibenden State-Topics sollten zuerst
Publisher-/Broker-Zeitpunkt und Topic-Sichtbarkeit geklärt werden;
keine `property/set`-Aufrufe, Flight Controls, Kameraaktionen
oder Netzwerkkonfigurationsänderungen sind für diesen Test zulässig.
## Fortgesetzte Live-Diagnose: MQTT-Verbindung seit 19:33 Uhr

Ein weiteres vom Benutzer direkt auf dem Pi abgefragtes
`GET /api/health` bestätigte am **21.10.2026** folgende
**backendprozessbezogene** Werte:

| Kriterium | Beobachtung |
|---|---|
| MQTT verbunden / fünf Subscriptions bestätigt | true / true |
| MQTT-Verbindungszeit | 19:33:31 MESZ (`1792604011174` ms) |
| Letzte MQTT-Nachricht | 20:02:42 MESZ (`1792605762029` ms) |
| Letztes OSD | 20:02:42 MESZ |
| Wiederhergestellte Geräte aus Redis-Topologie | 2 |
| OSD empfangen / angenommen | 1752 / 1752 |
| Events empfangen / angenommen | 876 / 876 |
| State empfangen / angenommen | **0 / 0** |
| Status empfangen / angenommen | **0 / 0** |
| Service-Reply empfangen / angenommen | 0 / 0 |

Der erfolgreiche OSD-/Event-Verkehr über einen Zeitraum von rund
29 Minuten nach MQTT-Connect beweist, dass **kein genereller
MQTT-Verbindungsverlust** besteht. Der Subscriber hat im aktuellen
Prozess seit dem Verbindungszeitpunkt jedoch **keine** neuen
`thing/product/+/state` oder `sys/product/+/status`
Nachrichten gesehen. Die Zwei-Geräte-Topologie stammt aus
einem **Redis-Restore** und ersetzt keinen neuen Topologie-Handshake.

DJI beschreibt `state` als **bei Änderung ausgelöst** und `osd`
als periodischen Kanal; `update_topo` wird in der offiziellen
Pilot-to-Cloud-Statusdokumentation als Online-/Offline-Ereignis
beschrieben. Deshalb erklärt eine laufende, unveränderte
Pilot-2-Sitzung die Kombination als **plausible Hypothese**,
aber noch nicht als gesicherte Ursache.

Nachprüfung **ohne MQTT-Payloads oder DJI-Kommandos**:

1. SkyHub-Backend und MQTT-Subscription verbunden lassen.
2. Nur bei am Boden stehenden Geräten nach normalem Aus-/Einschalten
   von Pilot 2 bzw. regulärer Cloud-Neuverbindung erneut passiv lesen.
   **Keine Flug- oder RTH-Einstellungen verändern.** Eine
   Neuverbindung garantiert keine `state`-Nachricht.
3. `mqttObservedChannelCounts.status/state` erneut prüfen und mit
   `mqttChannelCounts.status/state` und
   `topologyReplySent` vergleichen. Falls sie weiter bei null
   bleiben, zuerst den Publisher-/Broker-Nachrichtenpfad
   und den Zeitpunkt der Registrierung verifizieren, statt den
   feldtypisierten Parser anzupassen.

**Nicht erforderlich:** Pi-/EMQX-Neustart, Pairing-Reset,
Broker-ACL-Änderungen, `property/set` oder Flugtest.

## Unveränderte Grenzen

Es werden weder Multispektralbilddateien noch DJI SmartFarm-Indices
über MQTT behauptet. Die spätere Multispektral-Auswertung muss
RGB-/G-/R-/RE-/NIR-Mediendateien, Kalibrierungsmetadaten und
die DJI-Medien-API **separat** prüfen.
