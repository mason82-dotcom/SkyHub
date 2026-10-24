# DJI Cloud API 1.18: RC Plus 2 Enterprise + Matrice 4T hardware validation

**Historischer Stand:** 22.10.2026, am 23.10.2026 nach `main` integriert. **Abgleich am 24.10.2026:** [aktueller Evidence-Index](hardware-acceptance-status-2026-10-24.md). Der reine Diagnoseaufruf liest nur; eine nötige neue Geräte-Kopplung ist ein **separater, ausdrücklich zu bestätigender Schreibvorgang**. Kein Flug oder Deployment. Die Matrice-4T-/RC-Plus-2-Liveabnahme bleibt **offen**.

Die Prüfer sind aus dem älteren Diagnosezweig auf den nach PR #61/#47/#63 aktuellen Main-Stand portiert. Der geschützte HTTP-Modellkennungsfix wird **nicht** erneut überschrieben.
Details und Offline-Nachweise: [Diagnosekonsolidierung](hardware-diagnostics-consolidation.md).
Der ursprüngliche isolierte Branch bleibt als Herkunftsnachweis erhalten.

## Ziel und Umfang

Isolierte Hardware-Abnahme für:
- **DJI RC Plus 2 Enterprise:** `domain:type:sub_type = 2:174:0`, Gateway, offizielles RC-Plus-2-Webprofil mit **54** statischen Feldpfaden.
- **DJI Matrice 4T:** `domain:type:sub_type = 0:99:1`, Subdevice, **202 vorläufige** aus den generischen Aircraft-Spezifikationen abgeleitete statische Pfade und **neun** dokumentierte dynamische Gimbal-Feldtypen. Dieses Profil ist **keine** belegte gerätespezifische Vollständigkeitserklärung für DJI 1.18.

DJI bestätigt die Kombination Matrice 4E/4T + RC Plus 2 + DJI Pilot 2 in der [Produktunterstützung](https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-support.html). Die [RC-Plus-2-Property-Tabelle](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/properties.html) beschreibt die gerätespezifischen MQTT-Felder. Die ältere [allgemeine Aircraft-Property-Tabelle](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/aircraft/properties.html) beweist **nicht**, dass jedes Feld bei der M4T sendbar ist. DJI Cloud API unterstützt Pilot-to-Cloud über Pilot 2; die Drohne ist nicht selbst der Cloud-Gateway.

## Braucht die RC Plus 2 einen neuen DJI-Pilot-2-Benutzer?

**Nicht allein wegen der Kopplung mit SkyHub.** Drei Ebenen getrennt behandeln:

1. **DJI Pilot 2 / DJI-Konto:** bestehendes Konto und dieselbe DJI-Cloud-API-Anwendung/Lizenz können grundsätzlich weiterverwendet werden, sofern die vorhandene DJI-Konfiguration das zulässt. SkyHub erzeugt keine DJI-Benutzerkonten.
2. **SkyHub-Gerätekopplung:** **jede zusätzliche RC** wird einmalig und unabhängig mittels neuem sechsstelligen SkyHub-Code autorisiert. Danach hat die neue RC ein separates widerrufbares Geräte-Token. Vorhandene RC-Pro-Kopplung **nicht widerrufen**.
3. **MQTT-Broker-Zugang:** Die Pilot-MQTT-Identität ist vom lesenden Backend-Account getrennt. Ob auf dem Pi EMQX oder Mosquitto und welcher Port tatsächlich läuft, lässt sich **nicht** allein aus `main` ableiten. Die optionale separate Mosquitto-Konfiguration aus [PR #118](https://github.com/mason82-dotcom/SkyHub-Next/pull/118) ist kein Deploy-Nachweis. Broker-ACL/Client-ID/Port nur vor Ort **lesen**, niemals für diese Diagnose umkonfigurieren.

SkyHub speichert nur SHA-256-Hashes der Geräte-Tokens in Redis. Die neuen Tokens nicht in Git, Logs oder Chat kopieren.

## 0. Sicherheitsvoraussetzungen

- RC Plus 2 Enterprise und Matrice 4T sicher **am Boden**, gekoppelt und eingeschaltet, DJI Pilot 2 geöffnet.
- Der bereits laufende SkyHub-Next-Stack `skyhub-next` unter `~/Projekte/SkyHub-Next`. Den tatsächlich verwendeten MQTT-Broker (Mosquitto/EMQX), Reverse Proxy, PostGIS, Redis und Backend **nicht ändern**. Die Pi-Laufzeitversion kann vom GitHub-`main` abweichen.
- Sichtbar erreichbare bestehende SkyHub-Pilot-2-HTTPS-Seite (in Pilot 2: Cloud Services / Open Platforms); dieselbe URL wie bei der bestehenden RC, **kein erfundener zusätzlicher Endpunkt**.
- Der laufende Backend-Container stellt `GET /api/health`, `GET /api/devices`, `GET /api/diagnostics/mqtt-shapes` sowie intern `GET /api/pilot-admin/pairings` bereit und besitzt die erweiterten `deviceProperties`-/`propertyFieldObservedAt`-Snapshots. Der Pairing-Endpunkt benötigt View-Token und bleibt hinter dem lokalen Backend-Loopback.
- Vor jedem Test prüfen, ob die M4T in Pilot 2 erfolgreich gekoppelt ist. Die Geräte **nicht starten oder bewegen**.

## 1. Eigenständiges Worktree auf dem Raspberry Pi

```bash
cd ~/Projekte/SkyHub-Next
git status --short --branch
git fetch origin
git worktree add --detach ~/Projekte/SkyHub-RCPlus2-M4T-Test \
  origin/main
cd ~/Projekte/SkyHub-RCPlus2-M4T-Test
node --test backend/test/rc-plus2-m4t-hardware-validation.test.js
node scripts/pi-rc-plus2-m4t-check.js --help
```

Bei bereits vorhandenem Worktree zuerst `git worktree list` und `git status` im betreffenden Test-Worktree prüfen, **nicht** mit `git worktree add` überschreiben. Die obigen Befehle nutzen den aktuellen Quellstand von `origin/main` für die Offlineprüfer, installieren aber **keine** neue Pi-Backend-Version und starten keinen Dienst. Fehlt dem aktiven Container eine neuere Diagnose-API, gilt `NICHT PRÜFBAR`, nicht `BESTANDEN`.

## 1a. Vorabprüfung ohne DJI-Hardware (`--preflight`)

Ab dem zusätzlichen Preflight-Zweig wird zuerst geprüft, ob der **laufende** Pi-Backend-Container die erforderlichen vier lesenden GET-APIs bereitstellt und ob MQTT-/Topologie-ACK-Grundvoraussetzungen erfüllt sind. Die Drohnen dürfen dafür ausgeschaltet bleiben; dieser Modus verlangt **keine** frische OSD-Sitzung, kein neues RC-Pairing und keinen Flug.

```bash
cd ~/Projekte/SkyHub-RCPlus2-M4T-Test || exit 1
SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
  node scripts/pi-rc-plus2-m4t-check.js --preflight
printf 'Exitstatus: %s\n' "$?"
```

Nur acht festgelegte **Boolesche Statuswerte** verlassen bei `--preflight` den Backend-Container: GET-Health, GET-Devices, GET-MQTT-Shapes und GET-Pairings erreichbar, MQTT verbunden/subscribed und Topologie-ACK aktiviert/Publisher verbunden. Geräte-Snapshots, private Pairing-Einträge und MQTT-Rohwerte werden in diesem Modus **nicht** an die Host-Pipe weitergegeben. `0` = diese Pi-Backend-Voraussetzungen vorhanden; `3` = unvollständig (etwa lesende Pairing-API fehlt, MQTT nicht verbunden); `1` = Docker/API unerreichbar oder fehlerhafte Antwort; `2` = ungültiger Aufruf. **Ein Preflight mit Exit 0 ist ausdrücklich kein Live-Hardware-, DJI-Pilot-2-, M4T-Feld- oder Flugnachweis.**

Bei einem bestehenden Checkout, der die Option nicht kennt, zuerst nur im **isolierten** Worktree den Quellstand kontrollieren; keinesfalls den Pi-Backend-Container für das Preflight-Skript automatisch neu deployen. Der reguläre Aufruf **ohne** `--preflight` bleibt der eigentliche Live-Smoke in Abschnitt 3.

## 2. Einmalige Kopplung der **neuen** RC Plus 2

**Getrennter optionaler Freigabeschritt:** Nur falls noch keine unabhängige SkyHub-Kopplung besteht und der Betreiber die Einrichtung ausdrücklich bestätigt. `scripts/pi-pilot-pair.js` listet bei leerem Aufruf potenziell **private Kopplungscodes und Gerätekennungen**. Mit einem Code schreibt der Befehl die Autorisierung (`POST /api/pilot-admin/approve`). Das ist **kein read-only Hardwarecheck**; Ausgabe niemals in Chat/GitHub kopieren, niemals `--revoke` im Test benutzen.

1. In **DJI Pilot 2 auf der RC Plus 2** Cloud Services / Open Platforms und die **bestehende** SkyHub-HTTPS-URL öffnen; den Lizenz-/Workspace-Handshake abwarten.
2. Nur falls SkyHub einen neuen sechsstelligen Pairing-Code zeigt: **auf dem Pi im laufenden SkyHub-Next-Projekt**, nicht im isolierten Test-Worktree, lokal die vorhandenen Pairings anzeigen und den sichtbaren Code autorisieren:

```bash
cd ~/Projekte/SkyHub-Next
node scripts/pi-pilot-pair.js
# Den tatsächlich auf der RC angezeigten Code lokal einsetzen:
read -r -p "Sechsstelligen Code von der RC Plus 2 eingeben: " PAIR_CODE
node scripts/pi-pilot-pair.js "$PAIR_CODE"
unset PAIR_CODE
```

3. Auf der RC den Abschluss und den SkyHub-Workspace prüfen. Die bestehende RC Pro Enterprise behält ihr eigenes Token. Keine Tokens oder Geräte-IDs hier veröffentlichen.
4. Wenn kein Code erscheint und die RC bereits separat gekoppelt ist, **keinen erneuten Pairing-Vorgang erzwingen**. Eine bloße DJI-Kontoanmeldung ersetzt nicht die SkyHub-Token-Kopplung.

## 3. Read-only Live-Test (RC und M4T eingeschaltet)

```bash
cd ~/Projekte/SkyHub-RCPlus2-M4T-Test
SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
  node scripts/pi-rc-plus2-m4t-check.js
echo "Exitstatus: $?"
```

Das Testskript ruft `docker compose -p skyhub-next exec -T backend node -e` auf und liest ausschließlich vier vorhandene GET-APIs über den Container-Loopback `127.0.0.1:4000` (Health, Geräte, MQTT-Feldformen und geschützte lokale Pairing-Übersicht). Der View-Token bleibt **im Backend-Container**. API-Rohantworten werden nur in einer begrenzten lokalen Pipe verarbeitet. Das Terminal enthält ausschließlich Modelllabels, Zustände, anonyme Pairing-Anzahlen sowie feste **dokumentierte** Feldnamen; keine Seriennummern, sechsstelligen Pairing-Codes, Geräte-Tokens, GNSS-Koordinaten oder Messwerte.

**Exitcodes:** `0` = *aktueller Transport-/Feldparser-Smoketest **und** separate SkyHub-Geräte-Token-Verwendung in den letzten 30 Minuten bestätigt*, **nicht** vollständige 1.18-Konformität. `3` = unvollständig oder nicht eindeutig. `1` = Docker/Backend/JSON nicht lesbar. `2` = ungültige Argumente.

## 3a. Anonymer, maschinenlesbarer JSON-Prüfbeleg

Beide unverändert **lesenden** Modi unterstützen optional `--json`. Das CLI gibt genau ein JSON-Dokument auf `stdout` aus; **es speichert keine Datei** und ändert weder die RC-Kopplung noch Container oder MQTT. Die UTC-Zeit `measuredAt` stammt von der **Host-Uhr des Prüfskripts**, nicht aus einem DJI-signierten Ereignis.

```bash
cd ~/Projekte/SkyHub-RCPlus2-M4T-Test || exit 1
SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
  node scripts/pi-rc-plus2-m4t-check.js --preflight --json
# Bei real eingeschalteten, gekoppelten Geräten:
SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
  node scripts/pi-rc-plus2-m4t-check.js --json
```

**Vertrag `skyhub-rcplus2-m4t-evidence-v1`:** `mode=backend-preflight` enthält nur acht zuvor freigegebene Boolesche API-/MQTT-Gates. `mode=live-transport-smoke` enthält ausschließlich feste Modelltitel und Felder für MQTT-/ACK-Status, anonymisierte Pairing-Bestätigung, eindeutige Geräteverknüpfung, OSD-/State-Boolesche und **begrenzte Zähler** zu beobachteten statischen bzw. dynamischen Feldern. Im **ausgegebenen Prüfbeleg** erscheinen **keine** Seriennummern, Pilot-2-Benutzernamen, Kennungen, Positionen, Aufnahmeinhalte, frei übernommenen Feldnamen, Tokens oder Pairing-Codes. Im **Live-Modus** durchlaufen die bisherigen begrenzten API-Snapshots weiterhin die lokale Docker-Host-Pipe zur Auswertung; der neue JSON-Modus verhindert deren Ausgabe im Prüfbeleg, ersetzt aber keinen vollständigen In-Container-Datensparsamkeitsumbau. Der **Preflight** überträgt dagegen ausschließlich acht Boolesche. Zähler bei nicht verfügbarem Feldparser sind `null` statt erfundener Nullwerte.

`result=READY` bedeutet nur, dass der Backend-Preflight bestanden ist. `result=TRANSPORT_SMOKE_OK` bedeutet nur, dass die bisherige **eng begrenzte** Live-OSD-/Token-Smokeprüfung erfolgreich war. `result=INCOMPLETE` meldet fehlende Prüfvoraussetzungen, **keinen Hardwaredefekt**. In **allen** Fällen sind `hardwareAcceptanceComplete=false`, `flightReady=false` und `dispatchAllowed=false` fest verdrahtet. Exitcodes bleiben wie bisher `0/3/1/2`; `--json` ist kein Schreib- oder Deployment-Parameter.

Die JSON-Ausgabe ist zur freiwilligen **lokalen** Protokollierung oder zum Vergleich zweier Messungen gedacht. Nicht ungeprüft mit sensiblen Debug-Logs zusammenführen. Ein vollständig bestandener Prüfbeleg wird erst nach eigener manueller Zuordnung zu einem echten Gerät und Firmwarestand als Transport-Evidenz gewertet, niemals als Flug- oder Missionsfreigabe.

## 4. Abnahmematrix (Cloud API 1.18, Pilot-to-Cloud)

| Bereich | Positivnachweis | Grenzen |
| --- | --- | --- |
| MQTT | Backend verbunden und subscribed | Zähler sind backendweit |
| Handshake | `update_topo`/`status_reply` aktiviert **und separater MQTT-ACK-Publisher verbunden** | ACK-Zähler allein belegt noch keinen einzelnen Controller |
| RC Plus 2 | `2:174:0` Gateway, Topologie online | Nicht mit RC Pro `2:144:0` verwechseln |
| Pairing | SkyHub meldet separate RC-Plus-2-Geräte-Token-Registrierung und Verwendung innerhalb von 30 Minuten | Modellbezeichnung stammt vom WebView User-Agent; kein kryptografischer Hardware-Nachweis; keine DJI-Kontoidentität |
| Matrice 4T | `0:99:1` Subdevice, Topologie online | Nicht mit Mavic 3M `0:77:2` verwechseln |
| Kopplung | M4T verweist intern auf RC Plus 2 und ist als deren Kind erfasst | Keine Seriennummern ausgeben; mehrere mögliche Zielpaare = unklar |
| OSD | Beide Geräte liefern frische gültige OSD-Beobachtung unter 15 s | Kein Flug oder gültiger GNSS-Fix am Boden erforderlich |
| Connection | M4T `aircraftConnected=true` | Getrennte Geräte dürfen nicht durch alte OSD-Daten reaktiviert werden |
| State | Dokumentierte, getrennte State-Feldbeobachtung | Eventgesteuert, darf ohne Zustandsänderung alt sein |
| Properties | RC Plus 2: **54** dokumentierte statische Pfade, M4T: **202 vorläufige** generische statische Pfade + **9** dynamische Gimbal-Feldtypen | Nur tatsächlich beobachtete/aktuelle Pfade zählen; nicht alle müssen vorliegen; keine M4T-Geräteprofil-Vollständigkeitsgarantie |
| Privacy | `sn`, Token, `device_secret`, `nonce`, IMEI/EID und GPS-Werte nicht ausgeben | Redigierte Felder sind keine fehlenden Felder |
| RC Pro/M3M | Parallelbetrieb möglich; nur dedizierte RC-Plus-2/M4T-Paarung besteht Zieltest | Separate Live-Überprüfung erforderlich |

Das CLI meldet bewusst `NICHT PRÜFBAR`, wenn das laufende Backend die neue DJI-Feldschnittstelle oder die geschützte Pairing-Übersicht noch nicht bereitstellt, auch wenn die echte Topologie und das OSD bereits funktionieren. Das ist **kein** Beleg für fehlende DJI-Properties. In diesem Fall erst Laufzeitversion und Change-Freigabe separat prüfen; **kein automatisches Update**.

Ein früher empfangenes State-Ereignis bleibt in der optionalen Empfangsstufe
`BESTÄTIGT`, auch nach 15 Sekunden. Sein Alter und die weiterhin separat
berechnete Feldfrische bleiben sichtbar. Fehlende oder zukünftige State-Zeiten
werden nicht als Empfangsnachweis bestätigt. State ist kein OSD-Heartbeat.

## 5. Noch ausstehende echte Hardware-Nachweise

- Einmaliges Pilot-2-Pairing der neuen RC Plus 2, Kontrolle des unabhängigen Geräte-Tokens und anschließende erneute Anmeldung nach manuellem Pilot-2-Neustart.
- Gleichzeitiger Betrieb mit der RC Pro Enterprise / Mavic 3M ohne Verdrängung derselben MQTT-Client-ID.
- RC-Plus-2-spezifische Kamera- und Streamfähigkeit, `wireless_link`, `drc_state` und `cloud_control_auth` (Berechtigung **ohne Inhalt** prüfen).
- M4T: Live-OSD, GNSS/RTK, Akku, Kamera/Gimbal, Wärmebild- bzw. Laser-Feldbeobachtung **nur bei dokumentiertem und tatsächlich sendendem Sensor**. Keine aus generischen Schemas abgeleiteten Feldpflichten behaupten.
- HMS beim echten M4T-Ereignis, sichere Disconnect-/Reconnect-Sequenz sowie Firmware-/Protokollabweichungen.
- Die Felddefinitionen erneut mit den aktuellen, *gerätespezifischen* DJI-1.18-Quellen abgleichen und Abweichungen versioniert ergänzen.

**Keine Flugfreigabe:** Keine Fernsteuer-, `property/set`-, Mission-, Kamera- oder Flugbefehle, keine absichtlich ausgelösten Warnungen und keine Konfigurationsänderungen. Ohne Live-Geräte ist **kein Hardwaretest bestanden**.

## 6. Offline-Regression

```bash
cd ~/Projekte/SkyHub-RCPlus2-M4T-Test
node --check backend/rc-plus2-m4t-hardware-validation.js
node --check scripts/pi-rc-plus2-m4t-check.js
node --test backend/test/rc-plus2-m4t-hardware-validation.test.js \
  backend/test/rc-plus2-parallel-pairing.test.js \
  backend/test/hardware-diagnostics-integration.test.js \
  backend/test/rc-pro-m3m-hardware-validation.test.js \
  backend/test/dji-properties.test.js \
  backend/test/telemetry-field-audit.test.js
```

Die vorhandene GitHub-CI prüft außerdem sämtliche Backend-Tests, Syntax, Docker-Build und isolierte PostGIS-Tests. Dieser Testbranch greift niemals automatisch auf reale Pi-Hardware zu.
