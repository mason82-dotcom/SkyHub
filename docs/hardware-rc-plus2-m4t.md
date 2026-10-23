# DJI Cloud API 1.18: RC Plus 2 Enterprise + Matrice 4T hardware validation

**Stand:** 22.10.2026, auf aktuelle Main-Basis am 23.10.2026 neu integriert. **Modus:** Nur Lesen, kein Flug, kein Deployment. Die Matrice-4T-/RC-Plus-2-Hardwareabnahme ist **weiterhin offen**.

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
3. **EMQX-MQTT-Zugang:** die von SkyHub konfigurierte Pilot-MQTT-Identität ist getrennt vom lesenden Backend-Account. Sie muss nur dann zusätzlich provisioniert werden, wenn die Broker-ACL, Client-ID-Politik oder Betreiber-Anforderungen den Parallelbetrieb verhindern. Nichts automatisch ändern.

SkyHub speichert nur SHA-256-Hashes der Geräte-Tokens in Redis. Die neuen Tokens nicht in Git, Logs oder Chat kopieren.

## 0. Sicherheitsvoraussetzungen

- RC Plus 2 Enterprise und Matrice 4T sicher **am Boden**, gekoppelt und eingeschaltet, DJI Pilot 2 geöffnet.
- Der bereits laufende produktive SkyHub-Next-Stack `skyhub-next` unter `~/Projekte/SkyHub-Next`. Laufende EMQX-, Caddy-, PostGIS-, Redis- und Backend-Dienste **nicht ändern**.
- Sichtbar erreichbare bestehende SkyHub-Pilot-2-HTTPS-Seite (in Pilot 2: Cloud Services / Open Platforms); dieselbe URL wie bei der bestehenden RC, **kein erfundener zusätzlicher Endpunkt**.
- Der laufende Backend-Container stellt `GET /api/health`, `GET /api/devices`, `GET /api/diagnostics/mqtt-shapes` sowie intern `GET /api/pilot-admin/pairings` bereit und besitzt die erweiterten `deviceProperties`-/`propertyFieldObservedAt`-Snapshots. Der Pairing-Endpunkt benötigt View-Token und bleibt hinter dem lokalen Backend-Loopback.
- Vor jedem Test prüfen, ob die M4T in Pilot 2 erfolgreich gekoppelt ist. Die Geräte **nicht starten oder bewegen**.

## 1. Eigenständiges Worktree auf dem Raspberry Pi

```bash
cd ~/Projekte/SkyHub-Next
git status --short --branch
git fetch origin
git worktree add --detach ~/Projekte/SkyHub-RCPlus2-M4T-Test \
  origin/feature/hardware-diagnostics-current-main-20261023
cd ~/Projekte/SkyHub-RCPlus2-M4T-Test
node --test backend/test/rc-plus2-m4t-hardware-validation.test.js
node scripts/pi-rc-plus2-m4t-check.js --help
```

Bei bereits vorhandenem Worktree zuerst `git worktree list` und `git status` prüfen, nicht überschreiben. `git worktree add` startet keinen Dienst. Keine Dateien oder Container des Produktionsverzeichnisses werden geändert.

## 2. Einmalige Kopplung der **neuen** RC Plus 2

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
| Properties | RC Plus 2: 54 dokumentierte statische Pfade, M4T: 199 | Nur tatsächlich beobachtete/aktuelle Pfade zählen; nicht alle müssen vorliegen |
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
