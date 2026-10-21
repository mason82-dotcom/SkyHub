# Mavic 3M – Einordnung fehlender DJI Cloud API Kamera-/State-Feldpfade

**Stand:** 21.10.2026 · **Status:** Offline-Auswertung auf dem Pi lesbar,
kein Backend-Update erforderlich · DJI Cloud API 1.18

## Hardwareevidenz

Im echten Raspberry-Pi-Hardwaretest (RC Pro Enterprise + Mavic 3M)
wurden nach kontrolliertem Backend-Update 10/10 OSD-Meldungen verarbeitet.
M3M-Telemetrie war etwa 1 s alt. Der mit der Topologie eindeutig
zugeordneten M3M wurden 64 von 150 M3M-Feldpfaden als frisch bestätigt,
einschließlich sechs von sechs neuen, durch den Feldparser typisiert
angenommenen Generic-Aircraft-Erweiterungspfaden.

**Offen:** 76 auswertbare Pfade waren in der kurzen Sitzung noch nicht
beobachtet; 8 sind absichtlich redigiert und 2 untypisierte Felder
nicht inspectierbar. Die 76 sind keine 76 Fehler.

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

## Unveränderte Grenzen

Es werden weder Multispektralbilddateien noch DJI SmartFarm-Indices
über MQTT behauptet. Die spätere Multispektral-Auswertung muss
RGB-/G-/R-/RE-/NIR-Mediendateien, Kalibrierungsmetadaten und
die DJI-Medien-API **separat** prüfen.
