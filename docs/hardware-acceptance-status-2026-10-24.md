# SkyHub-Next: Hardwareabnahmen und offene Live-Gates (24.10.2026)

**Geprüfte GitHub-Basis:** \`543a05ca308071a850f43a153abf464c45e13738\` · **Typ:** datierter Evidence-Index, **keine neue Pi-Messung**. GitHub-Commits, synthetische Tests, reale Messungen aus früheren Pi-Sitzungen und tatsächliche Bereitstellung sind getrennte Aussagen. Ein neuer Commit verschiebt nicht das Datum oder den Umfang früherer Messungen.

## Nachweise und Grenzen

| Gerät/Funktion | Wirklich vorliegende Evidenz | Offen, nicht behaupten |
| --- | --- | --- |
| **RC Pro Enterprise (2:144:0) + Mavic 3M (0:77:2)** | Reale Pi-Sitzungen vom **21.10.2026**: MQTT, Topologie, frisches OSD, 6/6 neue M3M-OSD-Erweiterungspfade typisiert angenommen. Letzter dokumentierter State-Nachtest: 29 empfangen / 24 akzeptiert, davon RC 13, M3M 11; fünf in dieser Messung nachvollziehbar als Duplikate verworfen. Feldgenau 7 RC- und 5 M3M-State-Pfade beobachtet; 27/27 lokale Tests | RTH-/RC-Loss-Wirkung, Sicherheits-/Flugsteuerbefehle, weitere Firmware, kontinuierliche State-Zustellung, vollständige 150-Feld-Abdeckung |
| **DJI-M3M-Dateien im vorhandenen MinIO** | **22.10.2026:** sechs unbekannt benannte TIFFs mit gültigen Header-/IFD-/XMP-Probes; anschließende gemeinsame begrenzte Untersuchung von **8 TIFFs** mit **8/8** XMP-Ergebnissen. Bandhinweise **Red=4, NIR=4, Green=0, RedEdge=0** aus einem ausgewählten Prefix. Anonyme Feldnamen u.a. \`BandName\`, \`SensorGain\`, \`Irradiance\`, \`VignettingData\` | Gleichheit einer Aufnahmegruppe via CaptureUUID, vier vollständige multispektrale Sets, echte Pixelintegrität, Sensor-/Capture-Provenienz, Reflektanzkalibrierung, NDVI/NDRE-Freigabe |
| **RC Plus 2 Enterprise (2:174:0) + Matrice 4T (0:99:1)** | Geräte- und Parallel-Pairing-Evaluatoren nach [PR #66](https://github.com/mason82-dotcom/SkyHub-Next/pull/66) in main. Synthetische Parser-, Reconnect-/Replay- und Privatsphäretests, einschließlich eindeutiger Zuordnung und Exitstatus. **54** RC-Plus-2-Feldpfade und **202 vorläufige generische M4T-Feldpfade plus 9 dynamische Gimbaltypen** als Testkatalog, **nicht** als echte M4T-Verfügbarkeit | **Kein dokumentierter Live-Hardwaretest.** Neue Controller-Kopplung, unabhängige RC-Tokens und Parallelbetrieb, aktuelle OSD-/State-Sitzung, M4T-Thermal-/Payload-Pfade, DJI-Pilot-2-/Firmwarekompatibilität |
| **WPML/Waylines** | Offline-KMZ-/Kamerakadenzprüfung, synthetische Browser-/Node-Regressionen | Echte Pilot-2-KMZ-Importprüfung mit Firmware, Kameraauslösung, Mission oder Flugfreigabe |

**Quellen:** [RC Pro / M3M Hardwarebericht](hardware-rc-pro-m3m.md), [M3M State-Detail](m3m-camera-gap-analysis.md), [M3M-MinIO-XMP-Livetests](smart-farming-m3m-s3-hardware-smoke.md), [RC Plus 2 / M4T Anleitung](hardware-rc-plus2-m4t.md), [DIAG-Synthetik](hardware-diagnostics-consolidation.md), [Pilot-2-KMZ-Vertrag](dji-pilot2-kmz-acceptance.md).

## Verlässliche nächste Abnahmereihenfolge

1. **P0 – M4T-/RC-Plus-2-Boden-Smoke**: regulär gestartete DJI-Hardware, vorhandene Pilot-2-Cloud-Sitzung, separate SkyHub-Pairing-Prüfung, aktuelles OSD beider Geräte und eindeutige Gateway-Kind-Topologie. Nur das lesende Diagnoseskript verwenden; kein Flug, keine Kameraaktion. \`EXIT 0\` bestätigt lediglich dessen enges Transport-/Parser-/Token-Gate, **keine vollständige Hardware-/Feldabnahme**.
2. **P0 – kontrollierter Parallelbetrieb**: RC Pro/M3M bleibt separat online; RC Plus 2/M4T verdrängt keine MQTT-Client-ID. Historische Topologie im Redis ist kein Ersatz für neue Live-Telemetrie. Broker-/Port-/ACL-Konfiguration nicht allein aus dem GitHub-\`main\` ableiten.
3. **P1 – M3M CaptureUUID-Gruppierung**: optionaler \`--capture-groups-first-page\`-Test nur nach ausdrücklicher Freigabe zum Lesen begrenzter XMP-Bytebereiche. Aggregierter UUID-Gleichheitsbefund ist noch **keine** Bandregistrierung oder Kalibrierung.
4. **P1/P2 – echter vollständiger M3M-Satz**: eigene Aufnahme mit vier G/R/RE/NIR-TIFFs, optionalem RGB, privater Referenz-/Panel-Dokumentation, unveränderten Original-Hashes und pixelbasierter unabhängiger QA. Synthetische Rasterio-Ergebnisse aus [PR #100](https://github.com/mason82-dotcom/SkyHub-Next/pull/100) und [PR #126](https://github.com/mason82-dotcom/SkyHub-Next/pull/126) dürfen keine realen Kalibrierungsflags setzen.

## Gefahrloser Einstieg für die RC-Plus-2-/M4T-Abnahme

Zuerst vor Ort im Raspberry-Pi-Terminal kontrollieren, ob das **existierende** Projekt und der laufende Backend-Container verfügbar sind. Die GitHub-Version ist nicht automatisch die Pi-Version. **Nicht** durch die Hardwareprüfung deployen oder Broker/Ports verändern.

~~~bash
cd ~/Projekte/SkyHub-Next || exit 1
git status --short --branch
git fetch origin
git worktree list
docker compose -p skyhub-next ps
~~~

Wenn das **Test-Worktree noch nicht existiert**, einen **zusätzlichen** Checkout des aktuellen Referenzcodes anlegen:

~~~bash
git worktree add --detach ~/Projekte/SkyHub-RCPlus2-M4T-Test origin/main
cd ~/Projekte/SkyHub-RCPlus2-M4T-Test || exit 1
node --test backend/test/rc-plus2-m4t-hardware-validation.test.js \
  backend/test/rc-plus2-parallel-pairing.test.js \
  backend/test/hardware-diagnostics-integration.test.js
node scripts/pi-rc-plus2-m4t-check.js --help
~~~

Falls der Worktree-Ordner bereits existiert: **nicht überschreiben**, zuerst dessen \`git status\` und \`git worktree list\` prüfen. \`git fetch\` und \`git worktree add\` ersetzen **nicht** den laufenden Pi-Backend-Container.

Wenn die RC Plus 2 und die M4T tatsächlich **am Boden eingeschaltet, in Pilot 2 verbunden und separat autorisiert** sind und die Pi-Backend-Version die vier GET-APIs unterstützt:

~~~bash
cd ~/Projekte/SkyHub-RCPlus2-M4T-Test || exit 1
SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
  node scripts/pi-rc-plus2-m4t-check.js
printf 'Exitstatus: %s\n' "$?"
~~~

Das Skript liest nur \`/api/health\`, \`/api/devices\`, \`/api/diagnostics/mqtt-shapes\`, \`/api/pilot-admin/pairings\` über den **bereits laufenden** Backend-Container. Es schreibt **nicht** in den Broker oder DJI. \`0\` = begrenzter Smoke bestanden, \`3\` = keine vollständige Evidenz, \`1\` = Docker/API nicht lesbar, \`2\` = Argumentfehler.

**Wichtig zur Kopplung:** \`scripts/pi-pilot-pair.js <echter-code>\` ist ein **separater, absichtlich schreibender Freigabeschritt**, kein Bestandteil der lesenden Prüfung. Seine Listenansicht kann private Codes oder Gerätekennungen zeigen: niemals deren rohe Ausgabe in öffentliche Issues/Chats kopieren. Keine neue DJI-Identität oder SkyHub-Kopplung erzwingen, wenn eine aktive, getrennte Kopplung schon besteht.

**MQTT-Drift:** Frühere Anleitungen nennen EMQX/1884; neuere Arbeiten Mosquitto/1883 beziehungsweise einen optionalen separaten Mosquitto-Pilot-Broker auf 1884 ([PR #118](https://github.com/mason82-dotcom/SkyHub-Next/pull/118)). Die tatsächlich aktive Pi-Konfiguration ist hier **nicht verifiziert**. Weder \`docker compose up\`, Broker-Restart, \`.env\`-Änderung, neues Pairing noch ACL-Eingriffe aus diesem Dokument ableiten.

## Bericht und Freigabeentscheidung

Nur **anonymisierte Status- und Zählerwerte** samt Testdatum, geprüfter Git-/Backend-Version, Gerätemodellen und Firmwareversions-*status* (nicht vertrauliche Kennungen) erfassen. **Keine** Seriennummern, GPS-Koordinaten, XMP-Originale, S3-Objektschlüssel, Tokens, Passwörter, Paarungscodes oder MQTT-Rohpakete teilen.

Die Evidenz bleibt \`pilot2HardwareVerified:false\`, \`flightReady:false\`, \`dispatchAllowed:false\`; M3M-Kalibrierung, operative Agronomie und Maschinenexport ebenfalls **nicht freigegeben**. Ein erfolgreiches GitHub-CI-Signal ist kein Live-DJI-Testergebnis.
